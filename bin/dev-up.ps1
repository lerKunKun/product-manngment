# Windows dev-up: start docker compose infra stack
# Usage: .\bin\dev-up.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Stop other-project containers occupying our ports
$conflicts = @("saas_minio", "rabbitmq", "openshop-dev")
foreach ($c in $conflicts) {
    $running = docker ps --filter "name=^${c}$" --format "{{.Names}}" 2>$null
    if ($running -eq $c) {
        Write-Host "[port-fix] stopping $c (state preserved, can docker start later)" -ForegroundColor Yellow
        docker stop $c | Out-Null
    }
}

Write-Host "[docker] starting mysql / redis / rabbitmq / minio / minio-init ..." -ForegroundColor Cyan
docker compose -f docker-compose.dev.yml up -d mysql redis rabbitmq minio minio-init
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

Write-Host ""
Write-Host "[OK] infrastructure ready" -ForegroundColor Green
Write-Host "  MySQL       localhost:3307  (root/root)"
Write-Host "  Redis       localhost:6380"
Write-Host "  RabbitMQ    http://localhost:15672  (guest/guest)"
Write-Host "  MinIO API   localhost:9000"
Write-Host "  MinIO UI    http://localhost:9001  (minioadmin/minioadmin)"
Write-Host ""
Write-Host "Next:"
Write-Host "  .\bin\dev-backend.ps1   # Spring Boot"
Write-Host "  .\bin\dev-frontend.ps1  # Next.js"
Write-Host "  .\bin\dev-worker.ps1    # FastAPI worker (optional)"
