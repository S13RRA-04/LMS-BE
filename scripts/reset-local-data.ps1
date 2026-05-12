param(
  [string]$MongoContainer = "pact-lms-mongo",
  [string]$Database = "LMS"
)

$ErrorActionPreference = "Stop"

docker exec $MongoContainer mongosh $Database --quiet --eval "db.dropDatabase()" | Out-Null
npm run db:seed

Write-Output "Reset local Mongo database and reseeded LMS data"
