# Windows dev-down: stop docker stack + restore other-project containers
# Usage: .\bin\dev-down.ps1 [-Volumes]   # -Volumes wipes data volumes
param([switch]$Volumes)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[docker] stopping shopify-hub stack ..." -ForegroundColor Cyan
if ($Volumes) {
    docker compose -f docker-compose.dev.yml down -v
} else {
    docker compose -f docker-compose.dev.yml down
}

# restore containers paused by dev-up
$restore = @("saas_minio", "rabbitmq", "openshop-dev")
foreach ($c in $restore) {
    $exists = docker ps -a --filter "name=^${c}$" --format "{{.Names}}" 2>$null
    if ($exists -eq $c) {
        Write-Host "[restore] starting $c" -ForegroundColor Yellow
        docker start $c | Out-Null
    }
}

Write-Host ""
Write-Host "[OK] stopped" -ForegroundColor Green
Write-Host "  backend / frontend processes: terminate manually with Ctrl+C or Stop-Process"
