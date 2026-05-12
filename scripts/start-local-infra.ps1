param(
  [string]$MongoContainer = "pact-lms-mongo",
  [string]$KeycloakContainer = "pact-lms-keycloak",
  [string]$KeycloakAdmin = "admin",
  [string]$KeycloakAdminPassword = "admin"
)

$ErrorActionPreference = "Stop"

function Ensure-Container {
  param(
    [string]$Name,
    [string]$Image,
    [string[]]$RunArgs
  )

  $existing = docker ps -a --filter "name=^/$Name$" --format "{{.Names}}"
  if ($existing -eq $Name) {
    $running = docker ps --filter "name=^/$Name$" --format "{{.Names}}"
    if ($running -ne $Name) {
      docker start $Name | Out-Null
    }
    return
  }

  docker run --name $Name @RunArgs -d $Image | Out-Null
}

Ensure-Container -Name $MongoContainer -Image "mongo:7" -RunArgs @("-p", "27017:27017")
Ensure-Container `
  -Name $KeycloakContainer `
  -Image "quay.io/keycloak/keycloak:26.2.4" `
  -RunArgs @(
    "-p", "8080:8080",
    "-e", "KEYCLOAK_ADMIN=$KeycloakAdmin",
    "-e", "KEYCLOAK_ADMIN_PASSWORD=$KeycloakAdminPassword",
    "start-dev"
  )

for ($i = 0; $i -lt 60; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/realms/master" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Write-Output "Local LMS infrastructure is running"
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

throw "Keycloak did not become ready on http://localhost:8080"
