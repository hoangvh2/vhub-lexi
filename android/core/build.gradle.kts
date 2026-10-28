import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.0.21"
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

// Reference vectors produced by the TypeScript implementation (web/test/vectors.test.ts).
sourceSets.test {
    resources.srcDir(layout.projectDirectory.dir("../../shared/vectors"))
}

dependencies {
    // Android ships org.json in the platform; plain JVM (unit tests) needs the artifact.
    compileOnly("org.json:json:20240303")
    testImplementation("org.json:json:20240303")
    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")
}

tasks.test {
    useJUnit()
}
