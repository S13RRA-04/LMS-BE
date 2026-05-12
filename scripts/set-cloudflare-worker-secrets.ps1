param(
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

function Read-DotEnvFile([string]$Path) {
  $values = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }

    $separator = $line.IndexOf("=")
    if ($separator -lt 1) {
      return
    }

    $key = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
    $values[$key] = $value
  }

  return $values
}

function Invoke-CheckedCommand([string]$Command, [string[]]$Arguments, [string]$InputValue) {
  $InputValue | & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile."
}

$values = Read-DotEnvFile $EnvFile
$secretNames = @(
  "MONGO_URI",
  "KEYCLOAK_ISSUER",
  "KEYCLOAK_JWKS_URI",
  "LTI_PLATFORM_KID",
  "LTI_PLATFORM_PRIVATE_KEY_PEM"
)

foreach ($name in $secretNames) {
  if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
    throw "$name is required in $EnvFile."
  }

  Invoke-CheckedCommand "npx" @("wrangler", "secret", "put", $name) $values[$name]
}
