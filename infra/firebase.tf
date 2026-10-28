resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.api]
}

resource "google_firebase_web_app" "web" {
  provider        = google-beta
  project         = var.project_id
  display_name    = "VH Lexi"
  deletion_policy = "DELETE"

  depends_on = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}

locals {
  # The app is served from, and signs in against, this one host: the custom domain when there is one,
  # otherwise the default Firebase Hosting host.
  default_host = "${var.project_id}.firebaseapp.com"
  host         = coalesce(var.custom_domain, local.default_host)
}

# ---------------------------------------------------------------- the Android app (optional)
# Registering the app with its signing certificate's SHA-1 creates the Android OAuth client Google
# sign-in needs. The build reads the values from the `android_env` output (android/app/build.gradle.kts).

resource "google_firebase_android_app" "android" {
  count           = length(var.android_sha1) > 0 ? 1 : 0
  provider        = google-beta
  project         = var.project_id
  display_name    = "VH Lexi Android"
  package_name    = var.android_package
  sha1_hashes     = [for h in var.android_sha1 : lower(replace(h, ":", ""))]
  deletion_policy = "DELETE"

  depends_on = [google_firebase_project.this]
}

data "google_firebase_android_app_config" "android" {
  count    = length(var.android_sha1) > 0 ? 1 : 0
  provider = google-beta
  project  = var.project_id
  app_id   = google_firebase_android_app.android[0].app_id
}

locals {
  android_config = length(var.android_sha1) > 0 ? jsondecode(base64decode(data.google_firebase_android_app_config.android[0].config_file_contents)) : null
}
