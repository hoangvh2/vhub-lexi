terraform {
  required_version = ">= 1.10"

  required_providers {
    google      = { source = "hashicorp/google", version = "~> 8.6" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 8.6" }
    archive     = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}

# Used only to switch on the two APIs every other call depends on. It must not use the project as
# its quota project, because that needs the very APIs this provider is about to enable.
provider "google" {
  alias   = "bootstrap"
  project = var.project_id
  region  = var.region
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
