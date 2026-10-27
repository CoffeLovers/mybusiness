plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    kotlin("kapt")
}

android {
    namespace = "com.mybusiness.core.network"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
        buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:3000/api/v1/\"")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:model"))
    implementation(project(":core:datastore"))

    api(libs.retrofit.core)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp.core)
    implementation(libs.okhttp.logging)

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)

    implementation(libs.hilt.android)
    kapt(libs.hilt.compiler)
    implementation(libs.timber)
}
