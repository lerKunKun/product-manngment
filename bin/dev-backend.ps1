# Windows dev-backend: load .env and run Spring Boot
# Usage: .\bin\dev-backend.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) {
    Write-Host "[ERR] .env not found. Copy .env.example to .env and fill values." -ForegroundColor Red
    exit 1
}

# Parse .env: supports KEY=VALUE, comments, blank lines, multi-line single/double quoted values (PEM)
$lines = Get-Content -Path ".env" -Raw -Encoding UTF8
$pos = 0
$len = $lines.Length
$loaded = 0
while ($pos -lt $len) {
    $eol = $lines.IndexOf("`n", $pos)
    if ($eol -lt 0) { $eol = $len }
    $line = $lines.Substring($pos, $eol - $pos).TrimEnd("`r")
    $pos = $eol + 1

    $trim = $line.TrimStart()
    if ($trim -eq "" -or $trim.StartsWith("#")) { continue }

    $eq = $line.IndexOf("=")
    if ($eq -lt 0) { continue }
    $key = $line.Substring(0, $eq).Trim()
    $val = $line.Substring($eq + 1)

    # multi-line single/double quote
    foreach ($q in @("'", '"')) {
        if ($val.StartsWith($q) -and -not ($val.Length -gt 1 -and $val.EndsWith($q))) {
            while ($pos -lt $len) {
                $eol2 = $lines.IndexOf("`n", $pos)
                if ($eol2 -lt 0) { $eol2 = $len }
                $next = $lines.Substring($pos, $eol2 - $pos).TrimEnd("`r")
                $pos = $eol2 + 1
                $val += "`n" + $next
                if ($next.Contains($q)) { break }
            }
            break
        }
    }

    # strip wrapping quotes
    if (($val.StartsWith("'") -and $val.EndsWith("'")) -or
        ($val.StartsWith('"') -and $val.EndsWith('"'))) {
        $val = $val.Substring(1, $val.Length - 2)
    }

    # do not override existing env vars
    if (-not (Test-Path "Env:$key")) {
        Set-Item -Path "Env:$key" -Value $val
        $loaded++
    }
}

$env:SPRING_PROFILES_ACTIVE = "dev"
Write-Host "[OK] loaded $loaded env vars from .env" -ForegroundColor Green
Write-Host "[OK] MYSQL: $env:MYSQL_HOST`:$env:MYSQL_PORT  REDIS: $env:REDIS_HOST`:$env:REDIS_PORT"
Write-Host "[OK] starting backend on :$env:APP_PORT ..." -ForegroundColor Cyan

Set-Location backend-api
& mvn spring-boot:run
