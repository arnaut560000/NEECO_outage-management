$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $AppRoot "server.env"
$LogDir = Join-Path $AppRoot "logs"
$DataDir = Join-Path $AppRoot "data"
$PythonExe = Join-Path $AppRoot ".venv\Scripts\python.exe"

New-Item -ItemType Directory -Force -Path $LogDir, $DataDir | Out-Null

function Set-EnvFromFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            return
        }
        $name, $value = $line.Split("=", 2)
        $name = $name.Trim()
        $value = $value.Trim()
        if ($name) {
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

Set-EnvFromFile -Path $EnvFile

if (-not (Test-Path -LiteralPath $PythonExe)) {
    throw "Virtual environment not found at $PythonExe. Run install_startup_task.ps1 first."
}

if (-not $env:OUTAGE_ENV) { $env:OUTAGE_ENV = "development" }
if (-not $env:OUTAGE_SECRET_KEY) { throw "OUTAGE_SECRET_KEY is missing. Check server.env." }
if (-not $env:OUTAGE_DB_PATH) { $env:OUTAGE_DB_PATH = Join-Path $DataDir "outage_management.sqlite3" }
if (-not $env:OUTAGE_BACKUP_DIR) { $env:OUTAGE_BACKUP_DIR = Join-Path $DataDir "backups" }
if (-not $env:OUTAGE_WORKSPACE_CACHE_DIR) { $env:OUTAGE_WORKSPACE_CACHE_DIR = Join-Path $DataDir "workspace_cache" }
if (-not $env:OUTAGE_AUTO_SEED_ADMIN) { $env:OUTAGE_AUTO_SEED_ADMIN = "0" }
if (-not $env:OUTAGE_SHOW_SEED_CREDENTIALS) { $env:OUTAGE_SHOW_SEED_CREDENTIALS = "0" }
if (-not $env:OUTAGE_DEBUG) { $env:OUTAGE_DEBUG = "0" }
if (-not $env:OUTAGE_SESSION_COOKIE_SECURE) { $env:OUTAGE_SESSION_COOKIE_SECURE = "0" }

New-Item -ItemType Directory -Force -Path $env:OUTAGE_BACKUP_DIR, $env:OUTAGE_WORKSPACE_CACHE_DIR | Out-Null

$hostAddress = if ($env:OUTAGE_HOST) { $env:OUTAGE_HOST } else { "0.0.0.0" }
$port = if ($env:OUTAGE_PORT) { $env:OUTAGE_PORT } else { "8080" }
$listen = "$hostAddress`:$port"
$stdoutLog = Join-Path $LogDir "server.out.log"
$stderrLog = Join-Path $LogDir "server.err.log"

Set-Location -LiteralPath $AppRoot

# Waitress writes normal startup messages to stderr. Older Windows PowerShell can
# promote native stderr to a terminating error when ErrorActionPreference is Stop,
# so relax it only around the long-running server process.
$ErrorActionPreference = "Continue"
& $PythonExe -m waitress --listen=$listen wsgi:app 1>> $stdoutLog 2>> $stderrLog
exit $LASTEXITCODE
