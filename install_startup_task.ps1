$ErrorActionPreference = "Stop"

$TaskName = "NEECO Outage Management Server"
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = Join-Path $AppRoot ".venv\Scripts\python.exe"
$EnvFile = Join-Path $AppRoot "server.env"
$RunScript = Join-Path $AppRoot "run_server.ps1"
$DataDir = Join-Path $AppRoot "data"
$LogDir = Join-Path $AppRoot "logs"

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this script from an elevated PowerShell window: right-click PowerShell and choose 'Run as administrator'."
    }
}

function New-SecretKey {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes)
}

Assert-Admin

New-Item -ItemType Directory -Force -Path $DataDir, $LogDir | Out-Null

if (-not (Test-Path -LiteralPath $PythonExe)) {
    python -m venv (Join-Path $AppRoot ".venv")
}

& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $AppRoot "requirements.txt")

if (-not (Test-Path -LiteralPath $EnvFile)) {
    $secret = New-SecretKey
    $dbPath = Join-Path $DataDir "outage_management.sqlite3"
    $backupDir = Join-Path $DataDir "backups"
    $workspaceDir = Join-Path $DataDir "workspace_cache"
    @(
        "# NEECO Outage Management server settings"
        "# This file is local to the server PC and should not be committed."
        "OUTAGE_ENV=development"
        "OUTAGE_SECRET_KEY=$secret"
        "OUTAGE_DB_PATH=$dbPath"
        "OUTAGE_BACKUP_DIR=$backupDir"
        "OUTAGE_WORKSPACE_CACHE_DIR=$workspaceDir"
        "OUTAGE_AUTO_SEED_ADMIN=0"
        "OUTAGE_SHOW_SEED_CREDENTIALS=0"
        "OUTAGE_DEBUG=0"
        "OUTAGE_SESSION_COOKIE_SECURE=0"
        "OUTAGE_HOST=0.0.0.0"
        "OUTAGE_PORT=8080"
    ) | Set-Content -LiteralPath $EnvFile -Encoding ASCII
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`"" `
    -WorkingDirectory $AppRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Starts the NEECO Outage Management System at boot before user login." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started scheduled task: $TaskName"
Write-Host "Server URL on this PC: http://127.0.0.1:8080"
Write-Host "Other PCs should open: http://SERVER-PC-IP:8080"
Write-Host "Logs: $LogDir"
Write-Host "Settings: $EnvFile"
