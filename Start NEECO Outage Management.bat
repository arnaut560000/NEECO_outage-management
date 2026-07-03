@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_app.ps1"
if errorlevel 1 (
    echo.
    echo NEECO Outage Management did not start. Read the message above.
    echo.
    pause
)
endlocal
