param(
  [string]$DllPath
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $DllPath) {
  $releaseDll = Join-Path $repoRoot "src-tauri\thumbnail-provider\target\release\aipaint_thumbnail_provider.dll"
  $debugDll = Join-Path $repoRoot "src-tauri\thumbnail-provider\target\debug\aipaint_thumbnail_provider.dll"
  if (Test-Path $releaseDll) {
    $DllPath = $releaseDll
  } elseif (Test-Path $debugDll) {
    $DllPath = $debugDll
  } else {
    throw "Thumbnail provider DLL was not found. Run npm.cmd run thumbnail:build first."
  }
}

$resolvedDll = (Resolve-Path $DllPath).Path
$providerClsid = "{8F3CF5A5-6B4E-4EB8-97F9-32AA4EA66FDD}"
$previewProviderClsid = "{A4C0C13D-4045-4FE7-9EB3-EBA856B93328}"
$thumbnailHandler = "{E357FCCD-A995-4576-B01F-234630154E96}"
$previewHandler = "{8895B1C6-B41F-4C1C-A562-0D564250836F}"
$previewHandlerAppId = "{6D2B5079-2F0B-48DD-AB7F-97CEC514D30B}"
$classesRoot = "HKCU:\Software\Classes"
$previewHandlersPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers"

function Set-DefaultValue([string]$Path, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Default registry value is empty: $Path"
  }
  New-Item -Path $Path -Force | Out-Null
  $prefix = "HKCU:\"
  if (-not $Path.StartsWith($prefix)) {
    throw "Set-DefaultValue only supports HKCU paths: $Path"
  }
  $regPath = "HKCU\" + $Path.Substring($prefix.Length)
  & reg.exe add "$regPath" /ve /t REG_SZ /d "$Value" /f | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set default registry value: $Path"
  }
}

function Set-StringValue([string]$Path, [string]$Name, [string]$Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }
  New-ItemProperty -Path $Path -Name $Name -PropertyType String -Value $Value -Force | Out-Null
}

$clsidPath = Join-Path $classesRoot "CLSID\$providerClsid"
$serverPath = Join-Path $clsidPath "InprocServer32"
$previewClsidPath = Join-Path $classesRoot "CLSID\$previewProviderClsid"
$previewServerPath = Join-Path $previewClsidPath "InprocServer32"
$extensionPath = Join-Path $classesRoot ".aipaint"
$extensionHandlerPath = Join-Path $extensionPath "ShellEx\$thumbnailHandler"
$extensionPreviewHandlerPath = Join-Path $extensionPath "ShellEx\$previewHandler"

Set-DefaultValue $clsidPath "AI Paint Thumbnail Provider"
Set-DefaultValue $serverPath $resolvedDll
Set-StringValue $serverPath "ThreadingModel" "Apartment"
Set-DefaultValue $previewClsidPath "AI Paint Preview Handler"
Set-StringValue $previewClsidPath "AppID" $previewHandlerAppId
Set-DefaultValue $previewServerPath $resolvedDll
Set-StringValue $previewServerPath "ThreadingModel" "Apartment"
Set-StringValue $extensionPath "Content Type" "application/x-aipaint"
Set-DefaultValue $extensionHandlerPath $providerClsid
Set-DefaultValue $extensionPreviewHandlerPath $previewProviderClsid
Set-StringValue $previewHandlersPath $previewProviderClsid "AI Paint Preview Handler"

Write-Host ".aipaint thumbnail and preview providers registered in HKCU: $resolvedDll"
Write-Host "Restart Explorer if old thumbnail cache entries remain."
