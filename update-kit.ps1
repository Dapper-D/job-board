<#
  Job Hunt Kit - one-time updater for kits installed before the board had an Update button
  (the first Windows/Codex kit, and version 2.0.0). Newer kits update from the board's Updates panel.

  1. Save this file into your kit folder (the one with setup.ps1 and the app folder).
  2. Right-click it > "Run with PowerShell", or in PowerShell from the kit folder:
       powershell -NoProfile -ExecutionPolicy Bypass -File .\update-kit.ps1
  Your answers, jobs, statuses, documents and logs are kept. Nothing is installed from scratch.
#>
param([string]$KitPath = '')
$ErrorActionPreference = 'Continue'
$Repo = 'Dapper-D/job-board'
function Fail($m) { Write-Host "`n$m" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')

# Which kit?
if (-not $KitPath) { $KitPath = Split-Path -Parent $MyInvocation.MyCommand.Path }
while (-not (Test-Path (Join-Path $KitPath 'app\package.json'))) {
  Write-Host "No Job Hunt Kit found in: $KitPath" -ForegroundColor Yellow
  $KitPath = (Read-Host 'Paste the path of your kit folder (the one with the app folder), or press Enter to stop').Trim('"', ' ')
  if (-not $KitPath) { exit 0 }
}
$pkg = Get-Content (Join-Path $KitPath 'app\package.json') -Raw | ConvertFrom-Json
if ($pkg.name -ne 'job-hunt-kit') { Fail "That folder isn't a Job Hunt Kit." }
if (-not (Test-Path (Join-Path $KitPath 'config.json'))) { Fail "This kit was never set up (no config.json). Run setup.ps1 instead." }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js not found. Run setup.ps1 from the kit folder first.' }
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { Fail "Node $(node -v) is too old. Install Node 22 LTS from https://nodejs.org, then run this again." }
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { Fail 'This needs Windows 10 (version 1803) or newer.' }

Write-Host "Kit folder: $KitPath"
Write-Host "Installed version: $($pkg.version)"
try { $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'job-hunt-kit-updater' } }
catch { Fail "Couldn't reach GitHub to find the latest version ($($_.Exception.Message))." }
$latest = $rel.tag_name.TrimStart('v')
Write-Host "Latest version:    $latest`n"
if ($rel.body) { Write-Host "What's new:"; Write-Host $rel.body; Write-Host '' }
$go = Read-Host 'Update now? Your answers, jobs, documents and logs are kept (y/n) [y]'
if ($go -match '^n') { exit 0 }

$tmp = Join-Path $env:TEMP ('jhk-update-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Write-Host 'Downloading...'
try { Invoke-WebRequest -Uri $rel.tarball_url -OutFile (Join-Path $tmp 'release.tar.gz') -UseBasicParsing -Headers @{ 'User-Agent' = 'job-hunt-kit-updater' } }
catch { Fail "Download failed ($($_.Exception.Message))." }
tar -xzf (Join-Path $tmp 'release.tar.gz') -C $tmp
$src = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'app\update.mjs') } | Select-Object -First 1
if (-not $src) { Fail "The download doesn't look like the kit." }

# The new version installs itself (keeps your data, backs up the old files, restarts the board).
Push-Location (Join-Path $src.FullName 'app')
node update.mjs --install-into "$KitPath" --source "$($src.FullName)" --start-board
$code = $LASTEXITCODE
Pop-Location
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
if ($code -ne 0) { Fail 'The update did not finish. Your previous version was put back. Details: logs\update.log in your kit folder.' }
Write-Host "`nDone. From now on, use the Updates panel on your board (or: node app\update.mjs)." -ForegroundColor Green
Read-Host 'Press Enter to close'
