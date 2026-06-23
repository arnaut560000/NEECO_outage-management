$ErrorActionPreference = "Stop"

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    python -m venv .venv
}

& ".venv\Scripts\python.exe" -m pip install -r requirements.txt

$env:OUTAGE_ENV = "development"
if (-not $env:OUTAGE_SECRET_KEY) {
    $env:OUTAGE_SECRET_KEY = "local-lan-test-secret-change-before-official-deployment"
}
$env:OUTAGE_AUTO_SEED_ADMIN = "1"
$env:OUTAGE_SHOW_SEED_CREDENTIALS = "0"
$env:OUTAGE_DEBUG = "0"

$port = if ($env:OUTAGE_PORT) { $env:OUTAGE_PORT } else { "8080" }
$addresses = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "Starting NEECO Outage Management System for LAN access..."
Write-Host "Keep this window open while other devices are using the system."
Write-Host ""
Write-Host "Open on this PC: http://127.0.0.1:$port"
foreach ($address in $addresses) {
    Write-Host "Open on another PC/phone: http://$address`:$port"
}
Write-Host ""
Write-Host "If another device cannot connect, allow TCP port $port in Windows Defender Firewall."
Write-Host ""

& ".venv\Scripts\python.exe" -m waitress --listen="0.0.0.0:$port" wsgi:app
