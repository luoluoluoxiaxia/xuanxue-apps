plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "tech.zsien.xuanshu.core.network"
    compileSdk = 37

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.android)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    // OkHttpClient 出现在 XuanshuNetwork 的公开签名里（SSE 要复用同一个实例），
    // 因此必须是 api 而非 implementation，否则调用方拿不到这个类型。
    api(libs.okhttp)
    api(libs.okhttp.eventsource)
    debugImplementation(libs.okhttp.logging)
}
