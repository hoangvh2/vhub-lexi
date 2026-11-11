# ---------------------------------------------------------------- Bộ đề in the cloud (Cloud Storage for Firebase)
# The content of an imported test (questions JSON, Listening audio, Part 1 pictures) is kept per person under
# users/{uid}/testsets/{id}/..., so every device of the learner can open it. Only the owner can read it (storage.rules).
#
# us-central1 on purpose: the Cloud Storage free tier (5 GB-months, 5k Class A + 50k Class B operations, 100 GB of
# downloads a month) only covers us-east1, us-west1 and us-central1. A test is ~0.1–45 MB, downloaded once per device.

resource "google_storage_bucket" "testsets" {
  project                     = var.project_id
  name                        = "${var.project_id}-lexi-testsets" # the apps derive this name from the project id
  location                    = "US-CENTRAL1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  # The learner's own study material: `terraform destroy` must not take it.
  force_destroy = false

  # The web app downloads with getBlob(), a cross-origin request from the app's host.
  cors {
    origin          = distinct(["https://${local.host}", "https://${local.default_host}", "https://${var.project_id}.web.app"])
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type", "Content-Length", "Content-Range"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.api]
}

resource "google_firebase_storage_bucket" "testsets" {
  provider  = google-beta
  project   = var.project_id
  bucket_id = google_storage_bucket.testsets.name

  depends_on = [google_firebase_project.this]
}

locals {
  storage_rules = replace(
    file("${path.module}/../storage.rules.tmpl"),
    "__ALLOWED_EMAILS__",
    join(", ", [for e in local.emails : format("'%s'", e)]),
  )
}

resource "google_firebaserules_ruleset" "storage" {
  project = var.project_id

  source {
    files {
      name    = "storage.rules"
      content = local.storage_rules
    }
  }

  depends_on = [google_firebase_storage_bucket.testsets]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_firebaserules_release" "storage" {
  project      = var.project_id
  name         = "firebase.storage/${google_storage_bucket.testsets.name}"
  ruleset_name = google_firebaserules_ruleset.storage.name
}

resource "google_firebase_app_check_service_config" "storage" {
  provider         = google-beta
  project          = var.project_id
  service_id       = "firebasestorage.googleapis.com"
  enforcement_mode = var.enforce_app_check ? "ENFORCED" : "UNENFORCED"

  depends_on = [google_firebase_app_check_recaptcha_enterprise_config.web, google_firebase_storage_bucket.testsets]
}
