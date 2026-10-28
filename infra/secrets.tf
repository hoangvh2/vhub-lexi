# Gemini key: created here (restricted to the Generative Language API) unless one is supplied.
# It is written straight into Secret Manager, so it never needs to be copied, typed or exported.
resource "google_apikeys_key" "gemini" {
  count        = var.gemini_api_key == null ? 1 : 0
  project      = var.project_id
  name         = "lexi-gemini"
  display_name = "VH Lexi - Gemini (server side)"

  restrictions {
    api_targets {
      service = "generativelanguage.googleapis.com"
    }
  }

  depends_on = [google_project_service.api]
}

locals {
  gemini_key = var.gemini_api_key != null ? var.gemini_api_key : google_apikeys_key.gemini[0].key_string
}

resource "google_secret_manager_secret" "gemini" {
  project   = var.project_id
  secret_id = "GEMINI_API_KEY"

  replication {
    auto {}
  }

  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret_version" "gemini" {
  secret      = google_secret_manager_secret.gemini.id
  secret_data = local.gemini_key
}

resource "google_secret_manager_secret_iam_member" "runtime_reads_gemini" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.gemini.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
