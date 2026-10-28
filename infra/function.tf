# Runtime identity of the function: only what it needs, nothing else.
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "lexi-enrich"
  display_name = "VH Lexi enrich function"

  depends_on = [google_project_service.api]
}

resource "google_project_iam_member" "runtime" {
  for_each = toset([
    "roles/datastore.user",                 # the daily quota counter in Firestore
    "roles/firebaseappcheck.tokenVerifier", # verify App Check tokens when enforced
    "roles/logging.logWriter",
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Build identity (Cloud Build): new projects no longer hand this to the default compute account.
resource "google_service_account" "build" {
  project      = var.project_id
  account_id   = "lexi-build"
  display_name = "VH Lexi function builds"

  depends_on = [google_project_service.api]
}

resource "google_project_iam_member" "build" {
  for_each = toset([
    "roles/cloudbuild.builds.builder",
    "roles/logging.logWriter",
    "roles/artifactregistry.writer",
  ])
  project = var.project_id
  role    = each.key
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_storage_bucket" "source" {
  project                     = var.project_id
  name                        = "${var.project_id}-lexi-fn-src"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.api]
}

resource "google_storage_bucket_iam_member" "build_reads_source" {
  bucket = google_storage_bucket.source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}

# infra/deploy.mjs compiles functions/ into infra/.build/functions before Terraform runs.
data "archive_file" "functions" {
  type        = "zip"
  source_dir  = "${path.module}/.build/functions"
  output_path = "${path.module}/.build/functions.zip"
}

resource "google_storage_bucket_object" "functions" {
  bucket = google_storage_bucket.source.name
  name   = "functions-${data.archive_file.functions.output_md5}.zip"
  source = data.archive_file.functions.output_path
}

resource "google_cloudfunctions2_function" "enrich" {
  project  = var.project_id
  name     = "enrich"
  location = var.region

  build_config {
    runtime         = "nodejs22"
    entry_point     = "enrich"
    service_account = google_service_account.build.id
    # The code is already compiled; do not run package.json scripts in the build.
    environment_variables = {
      GOOGLE_NODE_RUN_SCRIPTS = ""
    }
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.functions.name
      }
    }
  }

  service_config {
    service_account_email            = google_service_account.runtime.email
    available_memory                 = "256Mi"
    available_cpu                    = "1"
    timeout_seconds                  = 60
    min_instance_count               = 0
    max_instance_count               = 3
    max_instance_request_concurrency = 8
    ingress_settings                 = "ALLOW_ALL"
    all_traffic_on_latest_revision   = true

    environment_variables = merge(
      {
        ALLOWED_EMAILS    = join(",", local.emails)
        GEMINI_MODEL      = var.gemini_model
        GCLOUD_PROJECT    = var.project_id
        FIREBASE_CONFIG   = jsonencode({ projectId = var.project_id })
        ENFORCE_APP_CHECK = tostring(var.enforce_app_check)
      },
      # Browsers on the custom domain may call the function (CORS).
      var.custom_domain == null ? {} : { EXTRA_ORIGINS = "https://${var.custom_domain}" },
    )

    secret_environment_variables {
      key        = "GEMINI_API_KEY"
      project_id = var.project_id
      secret     = google_secret_manager_secret.gemini.secret_id
      version    = google_secret_manager_secret_version.gemini.version
    }
  }

  depends_on = [
    google_project_iam_member.build,
    google_project_iam_member.runtime,
    google_secret_manager_secret_iam_member.runtime_reads_gemini,
    google_storage_bucket_iam_member.build_reads_source,
    google_firestore_database.default,
  ]
}

# The function must be reachable by the apps; every call is authenticated inside the code
# (Google sign-in, allowlist, daily quota; App Check when enforced), not at the network edge.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.enrich.service_config[0].service
  role     = "roles/run.invoker"
  member   = "allUsers"
}
