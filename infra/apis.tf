locals {
  emails = [for e in var.allowed_emails : lower(trimspace(e))]

  apis = [
    "iam.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaseappcheck.googleapis.com",
    "identitytoolkit.googleapis.com",
    "recaptchaenterprise.googleapis.com",
    "secretmanager.googleapis.com",
    "apikeys.googleapis.com",
    "generativelanguage.googleapis.com",
    "cloudfunctions.googleapis.com",
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "logging.googleapis.com",
    "storage.googleapis.com",
    "billingbudgets.googleapis.com",
  ]
}

resource "google_project_service" "bootstrap" {
  provider = google.bootstrap
  for_each = toset(["serviceusage.googleapis.com", "cloudresourcemanager.googleapis.com"])

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_project_service" "api" {
  for_each = toset(local.apis)

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
  depends_on         = [google_project_service.bootstrap]
}

data "google_project" "this" {
  project_id = var.project_id
  depends_on = [google_project_service.bootstrap]
}
