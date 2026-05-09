$ErrorActionPreference = "Stop"

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}

& ".venv\Scripts\python.exe" -m pip install -r requirements.txt

$env:OUTAGE_ENV = "development"
$env:OUTAGE_SECRET_KEY = "replace-this-with-a-local-dev-secret-key"
$env:OUTAGE_AUTO_SEED_ADMIN = "1"
$env:OUTAGE_SHOW_SEED_CREDENTIALS = "1"
$env:OUTAGE_DEBUG = "1"

Write-Host "Starting Outage Management System at http://127.0.0.1:5000"
Write-Host "Default development login: admin / Admin@12345"
& ".venv\Scripts\python.exe" app.py
