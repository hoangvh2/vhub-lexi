variable "project_id" {
  description = "A NEW Google Cloud project for Lexi, with billing enabled (Cloud Functions need the Blaze plan). Use the Project ID, not the display name."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid Google Cloud project ID."
  }
}

variable "allowed_emails" {
  description = "Google accounts allowed to sign in and use the app. Written into the Firestore rules and the function at apply time, so the addresses never live in the repository."
  type        = list(string)
  validation {
    condition     = length(var.allowed_emails) > 0 && alltrue([for e in var.allowed_emails : can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+$", trimspace(e)))])
    error_message = "allowed_emails needs at least one address, and every entry must be a plain email address."
  }
}

variable "gemini_api_key" {
  description = "Leave null (recommended) to let Terraform create a Gemini key restricted to the Generative Language API in this project. Or paste an existing key."
  type        = string
  default     = null
  sensitive   = true
}

variable "gemini_model" {
  description = "Model used by the `enrich` function."
  type        = string
  default     = "gemini-3.5-flash-lite"
}

variable "region" {
  description = "Region of the functions. Fixed in functions/src/config.ts (REGION) and the web app's VITE_FUNCTIONS_REGION; change them together."
  type        = string
  default     = "asia-southeast1"

  validation {
    condition     = var.region == "asia-southeast1"
    error_message = "Only asia-southeast1 is supported: it is fixed in functions/src/config.ts."
  }
}

variable "firestore_location" {
  description = "Firestore location. Cannot be changed after the database exists."
  type        = string
  default     = "asia-southeast1"
}

variable "enable_pitr" {
  description = "Point-in-time recovery for Firestore (7 days). Protects against accidental deletes."
  type        = bool
  default     = true
}

variable "enforce_app_check" {
  description = "Reject Firestore requests without a valid App Check token. Keep false while the Android app is sideloaded: a sideloaded APK cannot get a token (see infra/README.md)."
  type        = bool
  default     = false
}

variable "billing_account_id" {
  description = "Optional. With monthly_budget it creates a budget that emails the billing admins at 50/90/100%."
  type        = string
  default     = null
}

variable "monthly_budget" {
  description = "Monthly budget in the billing account's currency (whole units)."
  type        = number
  default     = null
}

variable "budget_currency" {
  description = "Must equal the billing account's currency, e.g. USD or VND."
  type        = string
  default     = "USD"
}

variable "custom_domain" {
  description = "The hostname you connected to Firebase Hosting, e.g. lexi.vhub.id.vn. The app signs in and serves from it (see infra/README.md section 8)."
  type        = string
  default     = null
  validation {
    condition     = var.custom_domain == null ? true : can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.custom_domain))
    error_message = "custom_domain must be a plain lowercase hostname such as lexi.vhub.id.vn (no https://, no path)."
  }
}

variable "android_package" {
  description = "Application ID of the Android app (android/app/build.gradle.kts)."
  type        = string
  default     = "com.vh.lexi"
}

variable "android_sha1" {
  description = "SHA-1 fingerprints of the certificates that sign the Android app (debug and release). Registers the app in Firebase so Google sign-in works."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for h in var.android_sha1 : can(regex("^([0-9A-Fa-f]{2}:?){19}[0-9A-Fa-f]{2}$", h))])
    error_message = "Each android_sha1 entry is a SHA-1 fingerprint like AB:CD:...:EF (20 bytes)."
  }
}
