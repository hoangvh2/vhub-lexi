resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  point_in_time_recovery_enablement = var.enable_pitr ? "POINT_IN_TIME_RECOVERY_ENABLED" : "POINT_IN_TIME_RECOVERY_DISABLED"
  # `terraform destroy` must not be able to wipe your study history by accident.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABORT"

  depends_on = [google_project_service.api]
}

# The same rules file the tests run against, with the allowlist filled in.
locals {
  rules = replace(
    file("${path.module}/../firestore.rules.tmpl"),
    "__ALLOWED_EMAILS__",
    join(", ", [for e in local.emails : format("'%s'", e)]),
  )
}

resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = local.rules
    }
  }

  depends_on = [google_firestore_database.default]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_firebaserules_release" "firestore" {
  project      = var.project_id
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name
}
