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

function Get-DockerContainerEnvValue([string]$ContainerName, [string]$Name) {
  try {
    $value = docker inspect $ContainerName --format "{{range .Config.Env}}{{println .}}{{end}}" 2>$null |
      ForEach-Object {
        if ($_ -like "$Name=*") {
          $_.Substring($Name.Length + 1)
        }
      } |
      Select-Object -First 1
    return $value
  } catch {
    return $null
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
$issuerUri = [Uri]$KeycloakIssuer
$issuerSegments = $issuerUri.AbsolutePath.Trim("/").Split("/")
$issuerRealm = if ($issuerSegments.Length -ge 2 -and $issuerSegments[0] -eq "realms") { $issuerSegments[1] } else { "cetu" }
$env:KEYCLOAK_ADMIN_BASE_URL = if ($env:KEYCLOAK_ADMIN_BASE_URL) { $env:KEYCLOAK_ADMIN_BASE_URL.TrimEnd("/") } else { $issuerUri.GetLeftPart([System.UriPartial]::Authority) }
$env:KEYCLOAK_ADMIN_REALM = if ($env:KEYCLOAK_ADMIN_REALM) { $env:KEYCLOAK_ADMIN_REALM } else { $issuerRealm }
$env:KEYCLOAK_ADMIN_TOKEN_REALM = if ($env:KEYCLOAK_ADMIN_TOKEN_REALM) { $env:KEYCLOAK_ADMIN_TOKEN_REALM } else { "master" }
$env:KEYCLOAK_ADMIN_CLIENT_ID = if ($env:KEYCLOAK_ADMIN_CLIENT_ID) { $env:KEYCLOAK_ADMIN_CLIENT_ID } else { "admin-cli" }
if (-not $env:KEYCLOAK_ADMIN_USERNAME) {
  $env:KEYCLOAK_ADMIN_USERNAME = Get-DockerContainerEnvValue "pact-lms-keycloak" "KEYCLOAK_ADMIN"
}
if (-not $env:KEYCLOAK_ADMIN_PASSWORD) {
  $env:KEYCLOAK_ADMIN_PASSWORD = Get-DockerContainerEnvValue "pact-lms-keycloak" "KEYCLOAK_ADMIN_PASSWORD"
}
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
