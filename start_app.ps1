$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = Join-Path $AppRoot ".venv\Scripts\python.exe"
$EnvFile = Join-Path $AppRoot "server.env"
$RunScript = Join-Path $AppRoot "run_server.ps1"
$DataDir = Join-Path $AppRoot "data"
$LogDir = Join-Path $AppRoot "logs"
$Port = "8080"
$Url = "http://127.0.0.1:$Port"

function New-SecretKey {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Ensure-ServerEnv {
    if (Test-Path -LiteralPath $EnvFile) {
        return
    }

    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $secret = New-SecretKey
    $dbPath = Join-Path $DataDir "outage_management.sqlite3"
    $backupDir = Join-Path $DataDir "backups"
    $workspaceDir = Join-Path $DataDir "workspace_cache"
    @(
        "# NEECO Outage Management local server settings"
        "# This file is local to this PC and should not be committed."
        "OUTAGE_ENV=development"
        "OUTAGE_SECRET_KEY=$secret"
        "OUTAGE_DB_PATH=$dbPath"
        "OUTAGE_BACKUP_DIR=$backupDir"
        "OUTAGE_WORKSPACE_CACHE_DIR=$workspaceDir"
        "OUTAGE_AUTO_SEED_ADMIN=1"
        "OUTAGE_SHOW_SEED_CREDENTIALS=1"
        "OUTAGE_DEBUG=0"
        "OUTAGE_SESSION_COOKIE_SECURE=0"
        "OUTAGE_HOST=0.0.0.0"
        "OUTAGE_PORT=$Port"
    ) | Set-Content -LiteralPath $EnvFile -Encoding ASCII
}

function Test-ServerRunning {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$Url/login" -TimeoutSec 2
        return [int]$response.StatusCode -ge 200
    } catch {
        return $false
    }
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python is not installed or is not added to PATH. Install Python 3, then run this launcher again."
}

Set-Location -LiteralPath $AppRoot
New-Item -ItemType Directory -Force -Path $LogDir, $DataDir | Out-Null

Ensure-ServerEnv

if (-not (Test-Path -LiteralPath $PythonExe)) {
    Write-Host "Creating Python virtual environment..."
    python -m venv (Join-Path $AppRoot ".venv")
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the Python virtual environment."
    }
}

Write-Host "Installing/updating required packages..."
& $PythonExe -m pip install -r (Join-Path $AppRoot "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    throw "Could not install required Python packages."
}

if (-not (Test-ServerRunning)) {
    Write-Host "Starting NEECO Outage Management..."
    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`"" `
        -WorkingDirectory $AppRoot `
        -WindowStyle Hidden | Out-Null
}

$started = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    if (Test-ServerRunning) {
        $started = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $started) {
    Write-Host "The server did not answer yet. Check logs\server.err.log for details."
    Write-Host "Correct local URL: $Url"
    Write-Host "Press any key to close..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "Opening $Url"
Start-Process $Url
