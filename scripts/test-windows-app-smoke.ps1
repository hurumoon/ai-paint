param(
  [string]$ExePath = (Join-Path $PSScriptRoot "..\src-tauri\target\release\ai-paint.exe"),
  [int]$StartupTimeoutSeconds = 20,
  [int]$SurvivalSeconds = 5
)

$ErrorActionPreference = "Stop"

if ($StartupTimeoutSeconds -le 0) {
  throw "StartupTimeoutSeconds must be greater than zero."
}
if ($SurvivalSeconds -le 0) {
  throw "SurvivalSeconds must be greater than zero."
}

$resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
$process = $null
$readyFile = Join-Path ([IO.Path]::GetTempPath()) (
  "ai-paint-smoke-{0}.ready" -f [Guid]::NewGuid().ToString("N")
)
$readyEnvName = "AI_PAINT_SMOKE_READY_FILE"
$hadPreviousReadyEnv = Test-Path -LiteralPath "Env:$readyEnvName"
$previousReadyEnv = [Environment]::GetEnvironmentVariable($readyEnvName, "Process")

try {
  try {
    [Environment]::SetEnvironmentVariable($readyEnvName, $readyFile, "Process")
    $process = Start-Process -FilePath $resolvedExe -PassThru
  } finally {
    if ($hadPreviousReadyEnv) {
      [Environment]::SetEnvironmentVariable($readyEnvName, $previousReadyEnv, "Process")
    } else {
      [Environment]::SetEnvironmentVariable($readyEnvName, $null, "Process")
    }
  }

  $startupDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $windowCreated = $false
  $frontendReady = $false

  while ((Get-Date) -lt $startupDeadline) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()

    if ($process.HasExited) {
      throw "AI Paint exited before creating its main window (exit code: $($process.ExitCode))."
    }
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
      $windowCreated = $true
    }
    if (Test-Path -LiteralPath $readyFile -PathType Leaf) {
      $frontendReady = $true
    }
    if ($windowCreated -and $frontendReady) {
      break
    }
  }

  if (-not $windowCreated) {
    throw "AI Paint did not create a main window within $StartupTimeoutSeconds seconds."
  }
  if (-not $frontendReady) {
    throw "AI Paint did not report React startup completion within $StartupTimeoutSeconds seconds."
  }

  $survivalDeadline = (Get-Date).AddSeconds($SurvivalSeconds)
  while ((Get-Date) -lt $survivalDeadline) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()

    if ($process.HasExited) {
      throw "AI Paint exited during the $SurvivalSeconds-second survival check (exit code: $($process.ExitCode))."
    }
  }

  Write-Host "Windows app smoke passed: main window created, React reported ready, and process survived for $SurvivalSeconds seconds."
} finally {
  if ($null -ne $process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
      Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $readyFile -Force -ErrorAction SilentlyContinue
}
