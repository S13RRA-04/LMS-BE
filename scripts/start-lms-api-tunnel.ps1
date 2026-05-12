param(
  [string]$LocalUrl = "http://127.0.0.1:4000",
  [string]$EnvFile = "",
  [string]$ConfigPath = "",
  [string]$PublicUrl = "",
  [string[]]$EnvKeys = @("LMS_API_PUBLIC_URL", "PACT_LMS_API_URL", "APP_BASE_URL", "LTI_ISSUER"),
  [int]$ReadyTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $EnvFile = Join-Path $projectRoot "..\Environment\.env"
}

function Test-CommandExists([string]$Command) {
  return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Test-AbsoluteHttpUrl([string]$Value, [string]$Name, [bool]$RequireHttps) {
  $uri = $null
  if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$uri)) {
    throw "$Name must be an absolute URL."
  }

  if ($uri.Scheme -notin @("http", "https")) {
    throw "$Name must use http or https."
  }

  if ($RequireHttps -and $uri.Scheme -ne "https") {
    throw "$Name must use https."
  }
}

function Set-DotEnvValues([string]$Path, [hashtable]$Values) {
  $directory = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($directory) -and -not (Test-Path $directory)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
  }

  $lines = @()
  if (Test-Path $Path) {
    $lines = Get-Content $Path
  }

  $written = @{}
  $updated = foreach ($line in $lines) {
    $separator = $line.IndexOf("=")
    if ($separator -lt 1 -or $line.TrimStart().StartsWith("#")) {
      $line
      continue
    }

    $key = $line.Substring(0, $separator).Trim()
    if ($Values.ContainsKey($key)) {
      $written[$key] = $true
      "$key=$($Values[$key])"
    } else {
      $line
    }
  }

  foreach ($key in $Values.Keys) {
    if (-not $written.ContainsKey($key)) {
      $updated += "$key=$($Values[$key])"
    }
  }

  Set-Content -Path $Path -Value $updated
}

function Get-TryCloudflareUrl([string[]]$LogPaths) {
  foreach ($path in $LogPaths) {
    if (-not (Test-Path $path)) {
      continue
    }

    $content = Get-Content $path -Raw -ErrorAction SilentlyContinue
    $match = [regex]::Match($content, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    if ($match.Success) {
      return $match.Value.TrimEnd("/")
    }
  }

  return ""
}

if (-not (Test-CommandExists "cloudflared")) {
  throw "cloudflared is required. Install it, authenticate if using a named tunnel, then run this script again."
}

Test-AbsoluteHttpUrl -Value $LocalUrl -Name "LocalUrl" -RequireHttps $false

if (-not [string]::IsNullOrWhiteSpace($PublicUrl)) {
  Test-AbsoluteHttpUrl -Value $PublicUrl -Name "PublicUrl" -RequireHttps $true
}

if (-not [string]::IsNullOrWhiteSpace($ConfigPath) -and -not (Test-Path $ConfigPath)) {
  throw "ConfigPath does not exist: $ConfigPath"
}

try {
  Invoke-WebRequest -Uri $LocalUrl -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
  Write-Warning "The LMS API did not respond at $LocalUrl. Start the API before using the tunnel for PACT/LTI flows."
}

$logRoot = Join-Path $projectRoot ".logs"
if (-not (Test-Path $logRoot)) {
  New-Item -ItemType Directory -Path $logRoot | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = Join-Path $logRoot "lms-api-cloudflared-$timestamp.out.log"
$stderrPath = Join-Path $logRoot "lms-api-cloudflared-$timestamp.err.log"

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $arguments = @("tunnel", "--url", $LocalUrl, "--no-autoupdate")
  Write-Output "Starting quick Cloudflare Tunnel for $LocalUrl"
} else {
  $resolvedConfigPath = (Resolve-Path $ConfigPath).Path
  $arguments = @("tunnel", "--config", $resolvedConfigPath, "run")
  Write-Output "Starting named Cloudflare Tunnel using $resolvedConfigPath"
}

$process = Start-Process `
  -FilePath "cloudflared" `
  -ArgumentList $arguments `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -WindowStyle Hidden `
  -PassThru

try {
  $resolvedPublicUrl = $PublicUrl.TrimEnd("/")
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)

  while ([string]::IsNullOrWhiteSpace($resolvedPublicUrl) -and (Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      throw "cloudflared exited early with code $($process.ExitCode). See $stderrPath"
    }

    Start-Sleep -Seconds 1
    $resolvedPublicUrl = Get-TryCloudflareUrl @($stderrPath, $stdoutPath)
  }

  if ([string]::IsNullOrWhiteSpace($resolvedPublicUrl)) {
    throw "Timed out waiting for the Cloudflare Tunnel public URL. See $stderrPath"
  }

  $envUpdates = @{}
  foreach ($key in $EnvKeys) {
    if (-not [string]::IsNullOrWhiteSpace($key)) {
      $envUpdates[$key] = $resolvedPublicUrl
    }
  }

  Set-DotEnvValues -Path $EnvFile -Values $envUpdates
  Write-Output "LMS API tunnel is available at $resolvedPublicUrl"
  Write-Output "Updated public LMS URL keys in $EnvFile"
  Write-Output "Logs: $stdoutPath and $stderrPath"
  Write-Output "Press Ctrl+C to stop the tunnel."

  while (-not $process.HasExited) {
    Start-Sleep -Seconds 2
  }

  throw "cloudflared stopped with exit code $($process.ExitCode). See $stderrPath"
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
  }
}
