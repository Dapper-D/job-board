@echo off
rem Removes B3spoken (made by setup.cmd / setup.ps1). Double-click this file. Your files are kept unless you add -RemoveData.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
exit /b %ERRORLEVEL%
