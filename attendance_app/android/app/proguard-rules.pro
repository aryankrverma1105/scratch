# Flutter Proguard Rules
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Keep native methods and classes for plugins
-keepclasseswithmembernames class * {
    native <methods>;
}

# Square / OkHttp / Dio
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Flutter Local Notifications
-keep class com.dexterous.flutterlocalnotifications.** { *; }

# Geolocator & Location
-keep class com.baseflow.geolocator.** { *; }

# Background service
-keep class id.flutter.flutter_background_service.** { *; }

# SQLite / sqflite
-keep class com.tekartik.sqflite.** { *; }
