pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MyBusiness"

include(":app")
include(":core:model")
include(":core:common")
include(":core:designsystem")
include(":core:datastore")
include(":core:network")
include(":core:di")
include(":core:biometric")
include(":core:navigation")
include(":feature:auth")
include(":feature:dashboard")
include(":feature:banking")
include(":feature:widget")
include(":feature:chat")
