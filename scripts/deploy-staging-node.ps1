param(
  [string]$ImageName = "cetu-lms-api",
  [string]$Tag = "staging",
  [string]$EnvFile = ".env.staging",
  [int]$Port = 4000
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

if (-not (Test-Path $EnvFile)) {
  throw "Missing $EnvFile. Copy .env.staging.example to $EnvFile and fill in real staging values."
}

docker build -t "${ImageName}:${Tag}" .

$containerName = "${ImageName}-${Tag}"
$existing = docker ps -a --filter "name=^/$containerName$" --format "{{.Names}}"
if ($existing -eq $containerName) {
  docker rm -f $containerName | Out-Null
}

docker run `
  --name $containerName `
  --env-file $EnvFile `
  -p "${Port}:4000" `
  -d "${ImageName}:${Tag}" | Out-Null

Write-Output "Started $containerName on http://127.0.0.1:$Port"
Write-Output "Run npm run local:tunnel:lms-api to expose this real Express/Mongo API through Cloudflare Tunnel when needed."
