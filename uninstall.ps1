<#
  B3spoken - remove a source install (made by setup.ps1).
  Removes the B3spoken shortcuts and stops B3spoken if it's running. Keeps your files in %LOCALAPPDATA%\B3spoken
  unless you add -RemoveData. This folder itself is left alone: delete it yourself if you like.
#>
param([switch]$RemoveData, [switch]$Quiet)
$data = Join-Path $env:LOCALAPPDATA 'B3spoken'
$rec = $null
try { $rec = Get-Content -Raw (Join-Path $data 'source-install.json') | ConvertFrom-Json } catch {}
$links = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'B3spoken.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'B3spoken.lnk'))
if ($rec) { $links += $rec.shortcuts }
foreach ($l in ($links | Select-Object -Unique)) { if (Test-Path $l) { Remove-Item -Force $l; Write-Host "Removed $l" } }
try {
  $h = Get-Content -Raw (Join-Path $data 'helper.json') | ConvertFrom-Json
  $p = Get-Process -Id $h.pid -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $h.pid -Force; Write-Host 'Stopped B3spoken.' }
} catch {}
Remove-Item -Force (Join-Path $data 'source-install.json') -ErrorAction SilentlyContinue
if ($RemoveData) { Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue; Write-Host "Deleted your B3spoken files in $data" }
else { Write-Host "Your files are still in $data (run with -RemoveData to delete them)." }
if (-not $Quiet) { Read-Host 'Press Enter to close' }
