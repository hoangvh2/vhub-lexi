# org.json and the platform classes used by :core are part of the Android framework.
# Credential Manager finds its Google Play services provider by reflection (Google sign-in).
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
