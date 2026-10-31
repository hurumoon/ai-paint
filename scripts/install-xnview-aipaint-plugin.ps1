param(
  [string]$XnViewRoot,
  [string]$PluginDir,
  [string]$PluginPath,
  [string]$PluginFileName = "Xaipaint.usr"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $PluginPath) {
  $PluginPath = Join-Path $repoRoot "src-tauri\xnview-plugin\target\release\aipaint_xnview_plugin.dll"
}

if (-not (Test-Path $PluginPath)) {
  throw "XnView plugin DLL was not found. Run npm.cmd run xnview-plugin:build first."
}

if (-not $PluginDir) {
  if ($XnViewRoot) {
    $PluginDir = Join-Path $XnViewRoot "plugins"
  } else {
    $PluginDir = "C:\Program Files\XnViewMP\plugins"
  }
}

if (-not (Test-Path $PluginDir)) {
  throw "XnView plugins directory was not found: $PluginDir"
}

$targetPath = Join-Path $PluginDir $PluginFileName
$legacyDllPath = Join-Path $PluginDir "aipaint.dll"
$legacyUsrPath = Join-Path $PluginDir "aipaint.usr"
try {
  if (($PluginFileName -ne "aipaint.dll") -and (Test-Path $legacyDllPath)) {
    Remove-Item -LiteralPath $legacyDllPath -Force
  }
  if (($PluginFileName -ne "aipaint.usr") -and (Test-Path $legacyUsrPath)) {
    Remove-Item -LiteralPath $legacyUsrPath -Force
  }
  Copy-Item -LiteralPath (Resolve-Path $PluginPath).Path -Destination $targetPath -Force
} catch {
  throw "Cannot write to XnView plugins directory: $PluginDir. Run this script from an elevated PowerShell, or pass -PluginDir to a writable XnView Plugins directory."
}

Write-Host ".aipaint XnView plugin installed: $targetPath"
Write-Host "Restart XnView MP to load the plugin."
