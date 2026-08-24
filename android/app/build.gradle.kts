plugins {
    // AGP 9 起内置 Kotlin 支持，不能再叠加 org.jetbrains.kotlin.android，
    // 否则构建直接报错。详见 https://kotl.in/gradle/agp-built-in-kotlin
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "tech.zsien.xuanshu"
    // 用 37 编译是因为 Compose BOM 2026.08 的 animation-core 要求 API ≥37；
    // 这只影响能调用哪些 API，运行时行为由下面的 targetSdk 决定。
    compileSdk = 37

    defaultConfig {
        applicationId = "tech.zsien.xuanshu"
        minSdk = 24
        // Play 自 2026-08-31 起要求新应用 target API 36，这是上传闸门不是审核意见。
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            // 10.0.2.2 是模拟器映射到宿主机 loopback 的固定地址。
            buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:8099/\"")
        }
        release {
            buildConfigField("String", "BASE_URL", "\"https://xx.zsien.tech/\"")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":core:network"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.markdown.renderer.m3)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
