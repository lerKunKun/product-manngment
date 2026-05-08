# Windows dev-worker: build + start asset-worker container
# Usage: .\bin\dev-worker.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "[docker] building + starting asset-worker (first build ~3-5 min) ..." -ForegroundColor Cyan
docker compose -f docker-compose.dev.yml up -d --build asset-worker
if ($LASTEXITCODE -ne 0) { throw "asset-worker up failed" }

Write-Host ""
Write-Host "[OK] asset-worker ready on http://localhost:8765" -ForegroundColor Green
Write-Host "  health check: curl http://localhost:8765/health"
