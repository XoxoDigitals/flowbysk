import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.flowbrowser.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.flowbrowser.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 44
        versionName = "2.0"

        val defaultServer =
            (project.findProperty("DEFAULT_SERVER_URL") as String?)
                ?: localProps.getProperty("default.server.url")
                ?: "https://flowcreatorai.site"

        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServer\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            val defaultKeystore = rootProject.file("keystore/flowbrowser-release.jks")
            val storeFilePath = localProps.getProperty("RELEASE_STORE_FILE")
            if (storeFilePath != null && file(storeFilePath).exists()) {
                storeFile = file(storeFilePath)
                storePassword = localProps.getProperty("RELEASE_STORE_PASSWORD") ?: ""
                keyAlias = localProps.getProperty("RELEASE_KEY_ALIAS") ?: "flowbrowser"
                keyPassword = localProps.getProperty("RELEASE_KEY_PASSWORD") ?: ""
            } else if (defaultKeystore.exists()) {
                storeFile = defaultKeystore
                storePassword = "FlowCreatorAi_Android_2026!#v11"
                keyAlias = "flowbrowser"
                keyPassword = "FlowCreatorAi_Android_2026!#v11"
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSigning = signingConfigs.getByName("release")
            signingConfig = if (releaseSigning.storeFile != null && releaseSigning.storeFile!!.exists()) {
                releaseSigning
            } else {
                // Sideloadable APK for local testing when no release keystore is configured
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}

// Keep assets/www in sync with the obfuscated Windows client www-packed tree during builds.
tasks.register<Copy>("syncWwwAssets") {
    val packedDir = rootProject.file("../client-webview2/FlowBrowser/www-packed")
    val plainDir = rootProject.file("../client-webview2/FlowBrowser/www")
    from(if (packedDir.exists()) packedDir else plainDir)
    into(layout.projectDirectory.dir("src/main/assets/www"))
    exclude(
        "**/*.pdb",
        "**/*.xml",
        "**/*cdp*",
        "extensions/urban-vpn/**",
        "extensions/veo-auto/**",
        "scripts/veo-content-bundle.js"
    )
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    doFirst {
        val destRoot = layout.projectDirectory.dir("src/main/assets/www").asFile
        destRoot.resolve("extensions/urban-vpn").deleteRecursively()
        destRoot.resolve("extensions/veo-auto").deleteRecursively()
        destRoot.resolve("scripts/veo-content-bundle.js").delete()
    }
}

tasks.named("preBuild") {
    dependsOn("syncWwwAssets")
}
