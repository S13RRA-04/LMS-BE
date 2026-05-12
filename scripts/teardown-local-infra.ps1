param(
  [switch]$RemoveVolumes,
  [string[]]$Containers = @("pact-lms-mongo", "pact-lms-keycloak")
)

$ErrorActionPreference = "Stop"

foreach ($container in $Containers) {
  $exists = docker ps -a --filter "name=^/$container$" --format "{{.Names}}"
  if ($exists -eq $container) {
    if ($RemoveVolumes) {
      docker rm -f -v $container | Out-Null
    } else {
      docker stop $container | Out-Null
    }
  }
}

Write-Output "Local LMS infrastructure teardown complete"
