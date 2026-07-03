$ErrorActionPreference = "Stop"

$TaskName = "NEECO Outage Management Server"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task -and $task.State -eq "Running") {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

$processes = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "waitress" -and $_.CommandLine -match "wsgi:app"
}

if (-not $processes) {
    Write-Host "NEECO Outage Management is not running."
    exit 0
}

foreach ($process in $processes) {
    try {
        Stop-Process -Id $process.ProcessId -Force
        Write-Host "Stopped server process $($process.ProcessId)."
    } catch {
        Write-Host "Could not stop process $($process.ProcessId): $($_.Exception.Message)"
    }
}
