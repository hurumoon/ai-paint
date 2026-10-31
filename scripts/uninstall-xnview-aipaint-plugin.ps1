param(
  [string]$XnViewRoot,
  [string]$PluginDir,
  [string]$PluginFileName = "Xaipaint.usr"
)

$ErrorActionPreference = "Stop"

if (-not $PluginDir) {
  if ($XnViewRoot) {
    $PluginDir = Join-Path $XnViewRoot "plugins"
  } else {
    $PluginDir = "C:\Program Files\XnViewMP\plugins"
  }
}

$targetPath = Join-Path $PluginDir $PluginFileName
if (Test-Path $targetPath) {
  Remove-Item -LiteralPath $targetPath -Force
  Write-Host ".aipaint XnView plugin uninstalled: $targetPath"
} else {
  Write-Host ".aipaint XnView plugin was not installed: $targetPath"
}

$legacyDllPath = Join-Path $PluginDir "aipaint.dll"
if (Test-Path $legacyDllPath) {
  Remove-Item -LiteralPath $legacyDllPath -Force
  Write-Host ".aipaint legacy plugin removed: $legacyDllPath"
}

$legacyUsrPath = Join-Path $PluginDir "aipaint.usr"
if (Test-Path $legacyUsrPath) {
  Remove-Item -LiteralPath $legacyUsrPath -Force
  Write-Host ".aipaint legacy plugin removed: $legacyUsrPath"
}

$legacyUserPath = Join-Path $env:APPDATA "XnViewMP\PlugIns\xaipaint.usr"
if (Test-Path $legacyUserPath) {
  Remove-Item -LiteralPath $legacyUserPath -Force
  Write-Host ".aipaint legacy user plugin removed: $legacyUserPath"
}

Write-Host "Restart XnView MP if it was running."
