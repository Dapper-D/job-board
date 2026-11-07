<#
  B3spoken - Windows setup from source (for people who want to see every file that goes on their computer)
  Right-click this file > "Run with PowerShell", or in PowerShell from this folder:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
  What it does, and nothing else:
    1. Makes sure Node.js 22 or newer is installed (with winget, if it's missing).
    2. Adds a "B3spoken" shortcut to your Start menu (and your desktop if you add -Desktop).
       The shortcut runs: node "<this folder>\b3spoken\src\helper\main.mjs"
    3. Starts B3spoken, which opens in your browser at http://127.0.0.1:4747
  B3spoken has no other packages to download: everything it runs is in this folder.
  Your own files (resume, answers, tracker, documents) are kept in %LOCALAPPDATA%\B3spoken.
  To remove it: uninstall.ps1 in this folder.
  This is NOT the old Job Hunt Kit setup (that one lives on the main branch).
#>
param([switch]$Desktop, [switch]$NoLaunch, [switch]$Quiet)
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Helper = Join-Path $Root 'b3spoken\src\helper\main.mjs'
function Done { if (-not $Quiet) { Read-Host 'Press Enter to close' } }
function Fail($m) { Write-Host "`n$m" -ForegroundColor Red; Done; exit 1 }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

Write-Host 'B3spoken setup' -ForegroundColor Cyan
if (-not (Test-Path $Helper)) { Fail "Can't find $Helper. Run this from the folder you downloaded B3spoken into (it has a b3spoken folder inside)." }

RefreshPath
$major = 0
if (Has node) { $major = [int]((node -v).TrimStart('v').Split('.')[0]) }
if ($major -lt 22) {
  if (-not (Has winget)) { Fail 'Node.js 22 or newer is needed. Install the LTS version from https://nodejs.org, then run setup again.' }
  Write-Host 'Installing Node.js LTS with winget (Windows may ask for permission)...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent | Out-Host
  RefreshPath
  if (Has node) { $major = [int]((node -v).TrimStart('v').Split('.')[0]) }
}
if ($major -lt 22) { Fail 'Node.js was installed but this window cannot see it yet. Close PowerShell, open it again, and run setup again.' }
$Node = (Get-Command node).Source
Write-Host "Node.js $(node -v): $Node"

$shell = New-Object -ComObject WScript.Shell
$links = @(Join-Path ([Environment]::GetFolderPath('Programs')) 'B3spoken.lnk')
if ($Desktop) { $links += Join-Path ([Environment]::GetFolderPath('Desktop')) 'B3spoken.lnk' }
foreach ($l in $links) {
  $s = $shell.CreateShortcut($l)
  $s.TargetPath = $Node
  $s.Arguments = "`"$Helper`""
  $s.WorkingDirectory = $Root
  $s.Description = 'Open B3spoken'
  $s.IconLocation = "$Node,0"
  $s.Save()
  Write-Host "Shortcut: $l"
}
$data = Join-Path $env:LOCALAPPDATA 'B3spoken'
New-Item -ItemType Directory -Force -Path $data | Out-Null
@{ root = $Root; node = $Node; shortcuts = $links; installedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $data 'source-install.json')
Write-Host "Your files will be kept in: $data"

if (-not $NoLaunch) {
  Write-Host 'Starting B3spoken. It opens in your browser; keep its window open while you use it.' -ForegroundColor Green
  Start-Process -FilePath $Node -ArgumentList "`"$Helper`"" -WorkingDirectory $Root
}
Write-Host "`nDone. Next time, open B3spoken from the Start menu." -ForegroundColor Green
Done
