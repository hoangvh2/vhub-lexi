import java.util.Properties

plugins {
    id("com.android.application") version "8.7.3"
    kotlin("android") version "2.0.21"
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
    id("com.google.devtools.ksp") version "2.0.21-1.0.28"
}

// Release signing: CI may pass a private keystore through env vars. Without them the committed sideload key
// (keystore/sideload.jks, intentionally public) is used so every build can update the previous install in place.
val signingProps = Properties().apply {
    val f = rootProject.file("keystore/sideload.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

fun signingValue(env: String, prop: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: signingProps.getProperty(prop)

// Cloud sync (Firebase): identifiers, not secrets. From the environment (CI variables, or `terraform output android_env`)
// or gradle properties. Empty = the app runs phone-only, without an account.
fun cloudValue(name: String, default: String = ""): String =
    (System.getenv(name)?.takeIf { it.isNotBlank() } ?: (findProperty(name) as String?) ?: default).trim()
fun quoted(v: String) = "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.vh.lexi"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vh.lexi"
        minSdk = 29
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "0.1.0-dev"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "FIREBASE_API_KEY", quoted(cloudValue("FIREBASE_API_KEY")))
        buildConfigField("String", "FIREBASE_APP_ID", quoted(cloudValue("FIREBASE_APP_ID")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(cloudValue("FIREBASE_PROJECT_ID")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(cloudValue("FIREBASE_SENDER_ID")))
        buildConfigField("String", "FIREBASE_WEB_CLIENT_ID", quoted(cloudValue("FIREBASE_WEB_CLIENT_ID")))
        buildConfigField("String", "FUNCTIONS_REGION", quoted(cloudValue("FUNCTIONS_REGION", "asia-southeast1")))
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file(signingValue("SIGNING_STORE_FILE", "storeFile") ?: "keystore/sideload.jks")
            storePassword = signingValue("SIGNING_STORE_PASSWORD", "storePassword")
            keyAlias = signingValue("SIGNING_KEY_ALIAS", "keyAlias")
            keyPassword = signingValue("SIGNING_KEY_PASSWORD", "keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

dependencies {
    implementation(project(":core"))

    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Cloud sync. Configured in code from BuildConfig (no google-services.json, no plugin).
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-functions")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
