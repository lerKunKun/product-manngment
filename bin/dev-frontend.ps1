# Windows dev-frontend: start Next.js dev server
# Usage: .\bin\dev-frontend.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\frontend-admin"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "[setup] enabling pnpm via corepack ..." -ForegroundColor Yellow
    corepack enable pnpm
}

if (-not (Test-Path "node_modules")) {
    Write-Host "[setup] installing deps (pnpm install) ..." -ForegroundColor Yellow
    pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
}

Write-Host "[OK] starting frontend on http://localhost:3000 ..." -ForegroundColor Cyan
pnpm dev
