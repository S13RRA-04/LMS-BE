param(
  [string]$EnvFile = ".env.staging",
  [string]$PactApiBaseUrl = "https://cetu-pact-api-staging.cetu.workers.dev",
  [string]$ClientId = "pact-tool",
  [string]$Name = "PACT",
  [string]$DeploymentIds = "pact-course-deployment",
  [string]$LaunchUrl = "",
  [string]$DeepLinkUrl = "",
  [string]$TargetLinkUri = ""
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

function Set-DotEnvValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = @()
  if (Test-Path $Path) {
    $lines = Get-Content $Path
  }

  $found = $false
  $updated = foreach ($line in $lines) {
    $separator = $line.IndexOf("=")
    if ($separator -gt 0 -and $line.Substring(0, $separator).Trim() -eq $Name) {
      $found = $true
      "$Name=$Value"
    } else {
      $line
    }
  }

  if (-not $found) {
    $updated += "$Name=$Value"
  }

  Set-Content -Path $Path -Value $updated
}

function Require-HttpsUrl([string]$Value, [string]$Name) {
  $uri = $null
  if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne "https") {
    throw "$Name must be an absolute HTTPS URL."
  }
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Create it before updating staging tool registration."
}

$base = $PactApiBaseUrl.TrimEnd("/")
Require-HttpsUrl $base "PactApiBaseUrl"

if ([string]::IsNullOrWhiteSpace($LaunchUrl)) {
  $LaunchUrl = "$base/api/v1/lti/launch"
}
if ([string]::IsNullOrWhiteSpace($DeepLinkUrl)) {
  $DeepLinkUrl = "$base/api/v1/lti/deep-link"
}
if ([string]::IsNullOrWhiteSpace($TargetLinkUri)) {
  $TargetLinkUri = "$base/launch"
}

Require-HttpsUrl $LaunchUrl "LaunchUrl"
Require-HttpsUrl $DeepLinkUrl "DeepLinkUrl"
Require-HttpsUrl $TargetLinkUri "TargetLinkUri"

$jwksResponse = Invoke-WebRequest -Uri "$base/api/v1/lti/jwks" -UseBasicParsing -TimeoutSec 20
$jwks = $jwksResponse.Content | ConvertFrom-Json
if (-not $jwks.keys -or $jwks.keys.Count -lt 1) {
  throw "PACT JWKS endpoint did not return any keys."
}

$tool = @(
  @{
    clientId = $ClientId
    name = $Name
    deploymentIds = $DeploymentIds.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    redirectUris = @($LaunchUrl)
    deepLinkRedirectUris = @($DeepLinkUrl)
    targetLinkUri = $TargetLinkUri
    publicJwks = $jwks
    scopes = @(
      "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
      "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
      "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
      "https://purl.imsglobal.org/spec/lti-ags/scope/score"
    )
  }
)

$json = ($tool | ConvertTo-Json -Depth 20 -Compress)
Set-DotEnvValue -Path $EnvFile -Name "LTI_TOOLS_JSON" -Value $json
Write-Output "Updated LTI_TOOLS_JSON in $EnvFile with PACT launch, Deep Linking, and public JWKS."
