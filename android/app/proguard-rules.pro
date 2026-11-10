# org.json and the platform classes used by :core are part of the Android framework.
# Credential Manager finds its Google Play services provider by reflection (Google sign-in).
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}

# pdfbox-android (Bộ đề): the optional JPEG 2000 codec is not shipped; its fonts and glyph lists load by name from resources.
-dontwarn com.gemalto.jp2.**
-keep class com.tom_roush.pdfbox.** { *; }
-keep class com.tom_roush.fontbox.** { *; }
