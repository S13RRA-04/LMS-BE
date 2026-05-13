param(
  [string]$EnvFile = ".env.production"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

function Invoke-CheckedCommand([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Test-WorkerExists {
  $stdout = [System.IO.Path]::GetTempFileName()
  $stderr = [System.IO.Path]::GetTempFileName()
  try {
    $process = Start-Process `
      -FilePath "npx.cmd" `
      -ArgumentList @("wrangler", "secret", "list", "--env", "production") `
      -WorkingDirectory $projectRoot `
      -RedirectStandardOutput $stdout `
      -RedirectStandardError $stderr `
      -PassThru `
      -Wait `
      -WindowStyle Hidden

    return $process.ExitCode -eq 0
  } finally {
    Remove-Item -LiteralPath $stdout, $stderr -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Missing $EnvFile. Create it from .env.production.example and fill in production Mongo, Keycloak, and LTI values before deploying production."
}

Invoke-CheckedCommand "npm" @("run", "build")
Invoke-CheckedCommand "npm" @("test")
Invoke-CheckedCommand "npx" @("wrangler", "deploy", "--env", "production", "--dry-run")

if (-not (Test-WorkerExists)) {
  Write-Output "Production Worker does not exist yet. Creating it before uploading Worker secrets."
  Invoke-CheckedCommand "npx" @("wrangler", "deploy", "--env", "production")
}

Invoke-CheckedCommand "powershell" @("-ExecutionPolicy", "Bypass", "-File", "./scripts/set-cloudflare-worker-secrets.ps1", "-Target", "production", "-EnvFile", $EnvFile)
Invoke-CheckedCommand "npx" @("wrangler", "deploy", "--env", "production")

$health = Invoke-RestMethod "https://lms-api.cetu.online/health"
if (-not $health.ok) {
  throw "Production health smoke failed."
}

$jwks = Invoke-RestMethod "https://lms-api.cetu.online/api/v1/lti/jwks"
if (-not $jwks.keys -or $jwks.keys.Count -lt 1) {
  throw "Production JWKS smoke failed."
}

Write-Output "LMS-BE production deploy passed health and JWKS smoke checks."
