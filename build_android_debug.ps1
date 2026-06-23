$ErrorActionPreference = "Stop"

if (-not (Test-Path "android\gradlew.bat")) {
    Write-Host "Android project is missing. Creating it with Capacitor..."
    npx cap add android
}

$androidStudioJbr = "C:\Program Files\Android\Android Studio\jbr"
$defaultAndroidSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"

if (-not $env:JAVA_HOME -and (Test-Path $androidStudioJbr)) {
    $env:JAVA_HOME = $androidStudioJbr
    $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
}

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT -and (Test-Path $defaultAndroidSdk)) {
    $env:ANDROID_HOME = $defaultAndroidSdk
    $env:ANDROID_SDK_ROOT = $defaultAndroidSdk
    $env:PATH = "$env:ANDROID_HOME\platform-tools;$env:PATH"
}

if (-not $env:JAVA_HOME) {
    Write-Warning "JAVA_HOME is not set. Install Android Studio or JDK 17/21, then set JAVA_HOME to that JDK folder."
}

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
    Write-Warning "Android SDK path is not set. Install Android Studio, then set ANDROID_HOME to your Android SDK folder."
}

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"

npx cap sync android
Push-Location android
try {
    .\gradlew.bat assembleDebug
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "If the build succeeded, APK location:"
Write-Host "android\app\build\outputs\apk\debug\app-debug.apk"
