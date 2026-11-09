@echo off
rem B3spoken setup for Windows. Double-click this file: no PowerShell settings to change.
rem It removes the "downloaded from the internet" block from the files in this folder, then runs setup.ps1
rem with PowerShell's script policy relaxed for this one run only. Read setup.ps1 to see exactly what it does.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0.' -Recurse -File | Unblock-File"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
exit /b %ERRORLEVEL%
