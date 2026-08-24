<#
.SYNOPSIS
Checks dependencies, frees the requested port, and starts the Next.js dev server.

.EXAMPLE
./scripts/start.ps1

.EXAMPLE
./scripts/start.ps1 -Port 3111
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$packageJson = Join-Path $repoRoot 'package.json'
$packageLock = Join-Path $repoRoot 'package-lock.json'
$nodeModules = Join-Path $repoRoot 'node_modules'
$installMarker = Join-Path $nodeModules '.package-lock.json'

if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
    throw "package.json not found at $packageJson"
}

$nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    throw 'Node.js is not available in PATH. Install the version declared in .nvmrc first.'
}

$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    throw 'npm.cmd is not available in PATH. Reinstall Node.js/npm and try again.'
}

Push-Location -LiteralPath $repoRoot
try {
    Write-Host "[1/3] Checking package installation..." -ForegroundColor Cyan

    $needsInstall = -not (Test-Path -LiteralPath $nodeModules -PathType Container)

    if (-not $needsInstall -and (Test-Path -LiteralPath $packageLock -PathType Leaf)) {
        if (-not (Test-Path -LiteralPath $installMarker -PathType Leaf)) {
            $needsInstall = $true
        }
        else {
            $lockUpdated = (Get-Item -LiteralPath $packageLock).LastWriteTimeUtc
            $installedAt = (Get-Item -LiteralPath $installMarker).LastWriteTimeUtc
            if ($lockUpdated -gt $installedAt) {
                $needsInstall = $true
            }
        }
    }

    if (-not $needsInstall) {
        & $npmCommand.Source ls --depth=0 --silent *> $null
        if ($LASTEXITCODE -ne 0) {
            $needsInstall = $true
        }
    }

    if ($needsInstall) {
        if (Test-Path -LiteralPath $packageLock -PathType Leaf) {
            Write-Host 'Dependencies are missing or out of sync. Running npm ci...' -ForegroundColor Yellow
            & $npmCommand.Source ci
        }
        else {
            Write-Host 'package-lock.json is missing. Running npm install...' -ForegroundColor Yellow
            & $npmCommand.Source install
        }

        if ($LASTEXITCODE -ne 0) {
            throw "Package installation failed with exit code $LASTEXITCODE."
        }
    }
    else {
        Write-Host 'Dependencies are installed and consistent with package-lock.json.' -ForegroundColor Green
    }

    Write-Host "[2/3] Releasing port $Port..." -ForegroundColor Cyan

    $listeners = @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    )
    $processIds = @(
        $listeners |
            Select-Object -ExpandProperty OwningProcess -Unique |
            Where-Object { $_ -gt 0 -and $_ -ne $PID }
    )

    foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            continue
        }

        Write-Host "Stopping $($process.ProcessName) (PID $processId) on port $Port..." -ForegroundColor Yellow
        try {
            Stop-Process -Id $processId -Force -ErrorAction Stop
        }
        catch {
            throw "Unable to stop PID $processId on port $Port. Run this script with sufficient permission. $($_.Exception.Message)"
        }
    }

    $portReleased = $false
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
        $remaining = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($null -eq $remaining) {
            $portReleased = $true
            break
        }
        Start-Sleep -Milliseconds 200
    }

    if (-not $portReleased) {
        throw "Port $Port is still in use after waiting 5 seconds."
    }

    if ($processIds.Count -eq 0) {
        Write-Host "Port $Port is available." -ForegroundColor Green
    }
    else {
        Write-Host "Port $Port has been released." -ForegroundColor Green
    }

    Write-Host "[3/3] Starting development server at http://localhost:$Port ..." -ForegroundColor Cyan
    Write-Host 'Press Ctrl+C to stop the server.' -ForegroundColor DarkGray

    & $npmCommand.Source run dev -- -p $Port
    $devExitCode = $LASTEXITCODE

    if ($devExitCode -ne 0) {
        throw "Development server exited with code $devExitCode."
    }
}
finally {
    Pop-Location
}
