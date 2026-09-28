<#
.SYNOPSIS
    Restarts the locally-installed Null IDE with its Chromium HTTP cache
    cleared, so freshly-synced workbench assets actually show up.

.DESCRIPTION
    'Developer: Reload Window' only does a soft navigation reload -- Chromium
    still serves null-custom.css / null-splash.js from its on-disk cache
    (%APPDATA%\Null\Cache, \Code Cache) since the local asset protocol sends
    no cache-busting headers, so edits made via sync-local.ps1 can silently
    fail to appear. This script kills the running instance, clears that
    cache, and relaunches -- mirroring the detached-launcher pattern the
    in-app updater already uses to survive the app process exiting.
#>
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Null IDE",
    [string]$DataDir = "$env:APPDATA\Null"
)

$exe = Join-Path $InstallDir "Null.exe"

if (-not (Test-Path $exe)) {
    throw "Null.exe not found at '$exe'."
}

$installFullPath = [System.IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'

# Written out and launched detached *before* we kill the current instance,
# so it keeps running (Windows doesn't cascade-kill grandchildren on a plain
# Stop-Process) to wait it out, clear the cache, and relaunch.
$relaunchScript = @"
`$ErrorActionPreference = 'SilentlyContinue'
while (Get-Process -Name 'Null' -ErrorAction SilentlyContinue | Where-Object {
    `$_.MainModule.FileName -like '$installFullPath*'
}) {
    Start-Sleep -Milliseconds 200
}
foreach (`$dir in @('Cache', 'Code Cache', 'GPUCache')) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path '$DataDir' `$dir)
}
Start-Process '$exe'
"@

$launcherPath = Join-Path $env:TEMP "null-ide-reload-$([guid]::NewGuid()).ps1"
Set-Content -Path $launcherPath -Value $relaunchScript -Encoding UTF8

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $launcherPath
)

Write-Host "Relaunching Null IDE with a cleared cache..."

Get-Process -Name "Null" -ErrorAction SilentlyContinue | Where-Object {
    $_.MainModule.FileName -like "$installFullPath*"
} | Stop-Process -Force
