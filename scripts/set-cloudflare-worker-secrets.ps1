param(
  [ValidateSet("staging", "production")]
  [string]$Target = "staging",
  [string]$EnvFile
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

function New-MongoUri([string]$MongoUri, [hashtable]$Values) {
  $hasUsername = $Values.ContainsKey("MONGO_USERNAME") -and -not [string]::IsNullOrWhiteSpace($Values["MONGO_USERNAME"])
  $hasPassword = $Values.ContainsKey("MONGO_PASSWORD") -and -not [string]::IsNullOrWhiteSpace($Values["MONGO_PASSWORD"])

  if (-not $hasUsername -and -not $hasPassword) {
    return $MongoUri
  }

  if (-not $hasUsername -or -not $hasPassword) {
    throw "MONGO_USERNAME and MONGO_PASSWORD must both be set when either one is provided."
  }

  if ($MongoUri -notmatch "^(mongodb(?:\+srv)?://)(?:[^@/?]+@)?(.+)$") {
    throw "MONGO_URI in $EnvFile is not a valid MongoDB connection string."
  }

  $username = [uri]::EscapeDataString($Values["MONGO_USERNAME"])
  $password = [uri]::EscapeDataString($Values["MONGO_PASSWORD"])
  return "$($Matches[1])$username`:$password@$($Matches[2])"
}

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $EnvFile = ".env.$Target"
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile."
}

$values = Read-DotEnvFile $EnvFile
$values["MONGO_URI"] = New-MongoUri $values["MONGO_URI"] $values
$urlNames = @(
  "KEYCLOAK_ISSUER",
  "KEYCLOAK_JWKS_URI"
)
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

  if ($values[$name] -match "localhost|127\.0\.0\.1|example\.com") {
    throw "$name in $EnvFile points at a local or placeholder value and cannot be uploaded as a Cloudflare Worker secret."
  }
}

if ($values["MONGO_URI"] -match "authMechanism=MONGODB-X509|authMechanism=%24external|authSource=%24external") {
  throw "MONGO_URI in $EnvFile uses X.509 certificate auth. Cloudflare Worker deployments must use a MongoDB database-user URI."
}

if ($values["MONGO_URI"] -notmatch "^mongodb(\+srv)?://[^:/@]+:[^@]+@") {
  throw "MONGO_URI in $EnvFile must include MongoDB database-user credentials."
}

foreach ($name in $urlNames) {
  if ($values[$name] -notmatch "^https://") {
    throw "$name in $EnvFile must be an HTTPS URL."
  }
  if ($Target -eq "staging" -and $values[$name] -notmatch "staging" -and $values[$name] -notmatch "^https://keycloak\.cetu\.online/realms/cetu") {
    throw "$name in $EnvFile must point at a clearly named staging host or the canonical Keycloak issuer."
  }
  if ($Target -eq "production" -and $values[$name] -match "staging") {
    throw "$name in $EnvFile points at staging and cannot be uploaded as a production Worker secret."
  }
}

foreach ($name in $secretNames) {
  Invoke-CheckedCommand "npx" @("wrangler", "secret", "put", $name, "--env", $Target) $values[$name]
}
