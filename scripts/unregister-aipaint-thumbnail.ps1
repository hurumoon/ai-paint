$ErrorActionPreference = "Stop"

$providerClsid = "{8F3CF5A5-6B4E-4EB8-97F9-32AA4EA66FDD}"
$previewProviderClsid = "{A4C0C13D-4045-4FE7-9EB3-EBA856B93328}"
$thumbnailHandler = "{E357FCCD-A995-4576-B01F-234630154E96}"
$previewHandler = "{8895B1C6-B41F-4C1C-A562-0D564250836F}"
$classesRoot = "HKCU:\Software\Classes"
$previewHandlersPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers"

$paths = @(
  (Join-Path $classesRoot ".aipaint\ShellEx\$thumbnailHandler"),
  (Join-Path $classesRoot ".aipaint\ShellEx\$previewHandler"),
  (Join-Path $classesRoot "CLSID\$providerClsid"),
  (Join-Path $classesRoot "CLSID\$previewProviderClsid")
)

foreach ($path in $paths) {
  if (Test-Path $path) {
    Remove-Item -Path $path -Recurse -Force
  }
}

if (Test-Path $previewHandlersPath) {
  Remove-ItemProperty -Path $previewHandlersPath -Name $previewProviderClsid -ErrorAction SilentlyContinue
}

Write-Host ".aipaint thumbnail and preview providers unregistered from HKCU."
Write-Host "Restart Explorer if old thumbnail cache entries remain."
