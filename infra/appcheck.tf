resource "google_recaptcha_enterprise_key" "web" {
  project      = var.project_id
  display_name = "vhub-lexi-web"

  web_settings {
    integration_type  = "SCORE"
    allow_all_domains = false
    allowed_domains   = distinct([local.host, local.default_host, "${var.project_id}.web.app"])
  }

  depends_on = [google_project_service.api]
}

resource "google_firebase_app_check_recaptcha_enterprise_config" "web" {
  provider  = google-beta
  project   = var.project_id
  app_id    = google_firebase_web_app.web.app_id
  site_key  = google_recaptcha_enterprise_key.web.name
  token_ttl = "3600s"
}

resource "google_firebase_app_check_service_config" "firestore" {
  provider         = google-beta
  project          = var.project_id
  service_id       = "firestore.googleapis.com"
  enforcement_mode = var.enforce_app_check ? "ENFORCED" : "UNENFORCED"

  depends_on = [google_firebase_app_check_recaptcha_enterprise_config.web, google_firestore_database.default]
}
