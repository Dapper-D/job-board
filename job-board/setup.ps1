<#
  Job Hunt Kit - Windows setup
  Right-click this file > "Run with PowerShell", or in PowerShell from this folder:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
  Makes sure Node.js and Git are installed, then runs the setup (app\setup.mjs).
  Safe to run again: it updates what's there and keeps your data.
  Options are passed through, e.g.:  .\setup.ps1 --provider claude --no-schedule
#>
$ErrorActionPreference = 'Continue'
$Kit = Split-Path -Parent $MyInvocation.MyCommand.Path
function Fail($m) { Write-Host "`n$m" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function Winget($id, $name) {
  if (-not (Has winget)) { Fail "$name is missing and winget isn't available. Install $name yourself, then run setup again." }
  Write-Host "Installing $name (Windows may ask for permission)..."
  winget install -e --id $id --accept-source-agreements --accept-package-agreements --silent | Out-Host
  RefreshPath
}

RefreshPath
if (-not (Has node)) { Winget 'OpenJS.NodeJS.LTS' 'Node.js' }
if (-not (Has node)) { Fail 'Node.js was installed but this window cannot see it yet. Close PowerShell, open it again, and rerun setup.' }
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { Winget 'OpenJS.NodeJS.LTS' 'Node.js LTS (newer)'; $major = [int]((node -v).TrimStart('v').Split('.')[0]) }
if ($major -lt 22) { Fail "Node $(node -v) is too old. Install Node 22 LTS or newer from https://nodejs.org and rerun setup." }
if (-not (Has git)) { Winget 'Git.Git' 'Git' }
if (-not (Has git)) { Fail 'Git was installed but this window cannot see it yet. Close PowerShell, open it again, and rerun setup.' }

Push-Location (Join-Path $Kit 'app')
node setup.mjs @args
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail 'Setup stopped early. The reason is above, and in the logs folder.' }
Read-Host 'Press Enter to close'
