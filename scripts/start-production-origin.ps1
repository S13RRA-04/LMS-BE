param(
  [string]$EnvFile = ".env",
  [int]$Port = 4000,
  [string]$PublicBaseUrl = "https://lms-api.cetu.online",
  [string]$FrontendOrigin = "https://lms.cetu.online",
  [string]$PactApiBaseUrl = "https://pact2-api.cetu.online",
  [string]$PactJwksUrl = "http://127.0.0.1:4200/api/v1/lti/jwks",
  [string]$KeycloakIssuer = "https://keycloak.cetu.online/realms/cetu"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

function Import-DotEnv([string]$Path) {
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      return
    }

    $separator = $line.IndexOf("=")
    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Missing $EnvFile."
}

Import-DotEnv $EnvFile

$env:NODE_ENV = "production"
$env:PORT = $Port.ToString()
$env:APP_BASE_URL = $PublicBaseUrl
$env:LTI_ISSUER = $PublicBaseUrl
$env:CORS_ORIGINS = $FrontendOrigin
$env:MONGO_COLLECTION_PREFIX = ""
$env:KEYCLOAK_ISSUER = $KeycloakIssuer
$env:KEYCLOAK_JWKS_URI = "$KeycloakIssuer/protocol/openid-connect/certs"
$env:DOTENV_CONFIG_PATH = Join-Path $projectRoot ".env.production.empty"

if (-not (Test-Path -LiteralPath $env:DOTENV_CONFIG_PATH)) {
  New-Item -ItemType File -Path $env:DOTENV_CONFIG_PATH | Out-Null
}

$pactJwks = Invoke-RestMethod -Uri $PactJwksUrl -TimeoutSec 20
$tool = [ordered]@{
  clientId = "pact-tool"
  name = "PACT"
  deploymentIds = @("pact-course-deployment")
  redirectUris = @("$PactApiBaseUrl/api/v1/lti/launch")
  deepLinkRedirectUris = @("$PactApiBaseUrl/api/v1/lti/deep-link")
  targetLinkUri = "$PactApiBaseUrl/launch"
  publicJwks = $pactJwks
  scopes = @()
}
$env:LTI_TOOLS_JSON = ConvertTo-Json -InputObject @($tool) -Compress -Depth 20

npm run start
