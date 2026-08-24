plugins {
    // AGP 9 内置 Kotlin 支持，因此这里不再声明 org.jetbrains.kotlin.android。
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
