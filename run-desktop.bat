@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\desktop.ps1" %*
if errorlevel 1 (
    echo.
    echo E-Nay could not start. Read the error above for details.
    pause
    exit /b 1
)
