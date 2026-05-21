[CmdletBinding()]
param(
    [string]$Repo,
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Null IDE",
    [switch]$IncludePrerelease,
    [switch]$Force,
    [switch]$Launch,
    [switch]$WaitForExit
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Invoke-GitHubJson {
    param([string]$Uri)

    $headers = @{
        "Accept"               = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
        "User-Agent"           = "Null-IDE-Updater"
    }

    if ($env:GITHUB_TOKEN) {
        $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
    }

    Invoke-RestMethod -Uri $Uri -Headers $headers
}

function Get-LatestRelease {
    param(
        [string]$RepoName,
        [bool]$AllowPrerelease
    )

    $base = "https://api.github.com/repos/$RepoName/releases"

    if (-not $AllowPrerelease) {
        return Invoke-GitHubJson "$base/latest"
    }

    $releases = Invoke-GitHubJson "$base?per_page=30"
    $release = $releases | Where-Object { -not $_.draft } | Select-Object -First 1
    if (-not $release) {
        throw "No non-draft releases found for $RepoName."
    }

    $release
}

function ConvertTo-VersionValue {
    param([string]$Tag)

    $clean = $Tag.TrimStart("v")
    if ($clean -match '^\d+(\.\d+){0,3}$') {
        return [version]$clean
    }

    $null
}

function Test-UpdateNeeded {
    param(
        [string]$Current,
        [string]$Latest
    )

    if ($Force) {
        return $true
    }

    if (-not $Current -or $Current -eq "local") {
        return $true
    }

    if ($Current -eq $Latest) {
        return $false
    }

    $currentVersion = ConvertTo-VersionValue $Current
    $latestVersion = ConvertTo-VersionValue $Latest

    if ($currentVersion -and $latestVersion) {
        return $latestVersion -gt $currentVersion
    }

    return $true
}

$installFullPath = [System.IO.Path]::GetFullPath($InstallDir)
$metadataPath = Join-Path $installFullPath ".null-ide-install.json"

$current = "local"
if (Test-Path $metadataPath) {
    try {
        $raw = Get-Content $metadataPath -Raw | ForEach-Object { $_ -replace '^﻿', '' }
        $metadata = $raw | ConvertFrom-Json
        if (-not $Repo -and $metadata.repo) { $Repo = $metadata.repo }
        if ($metadata.version) { $current = [string]$metadata.version }
    }
    catch {
        Write-Warning "Could not read install metadata: $_"
    }
}

if (-not $Repo) {
    throw "Repository is not set. Pass -Repo owner/name or ensure .null-ide-install.json exists at $installFullPath."
}

Write-Step "Checking latest release from $Repo"
$release = Get-LatestRelease -RepoName $Repo -AllowPrerelease $IncludePrerelease.IsPresent
$latest = [string]$release.tag_name

if (-not (Test-UpdateNeeded -Current $current -Latest $latest)) {
    Write-Host "Null IDE is already up to date."
    Write-Host "Installed version: $current"
    return
}

Write-Host "Installed version: $current"
Write-Host "Latest version:    $latest"

$installer = Join-Path $PSScriptRoot "install-null-ide.ps1"
if (-not (Test-Path $installer)) {
    throw "Installer script not found next to updater: $installer"
}

if ($WaitForExit) {
    Write-Step "Waiting for Null IDE to close"
    $installPrefix = $installFullPath.TrimEnd('\') + '\'
    while ($true) {
        $running = Get-Process -Name "null" -ErrorAction SilentlyContinue | Where-Object {
            try {
                $_.MainModule.FileName.StartsWith($installPrefix, [System.StringComparison]::OrdinalIgnoreCase)
            }
            catch {
                $false
            }
        }

        if (-not $running) {
            break
        }

        Start-Sleep -Seconds 1
    }
}

$settingsPath = Join-Path $env:APPDATA "Null\User\settings.json"
$settingsSnapshot = $null
if (Test-Path $settingsPath) {
    try {
        $settingsSnapshot = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Step "Snapshotted settings.json ($($settingsSnapshot.PSObject.Properties.Count) keys)"
    }
    catch {
        Write-Warning "Could not snapshot settings.json — update will continue without restore: $_"
    }
}

Write-Step "Updating Null IDE"
$installerArgs = @{
    Repo                = $Repo
    Version             = $latest
    InstallDir          = $installFullPath
    Force               = $true
    NoDesktopShortcut   = $true
    NoStartMenuShortcut = $true
}

if ($IncludePrerelease) {
    $installerArgs.IncludePrerelease = $true
}

if ($Launch) {
    $installerArgs.Launch = $true
}

& $installer @installerArgs

if ($settingsSnapshot) {
    $after = $null
    if (Test-Path $settingsPath) {
        try { $after = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json }
        catch {}
    }

    $merged = [ordered]@{}
    if ($after) {
        foreach ($prop in $after.PSObject.Properties) {
            $merged[$prop.Name] = $prop.Value
        }
    }

    $restored = @()
    foreach ($prop in $settingsSnapshot.PSObject.Properties) {
        if (-not $merged.Contains($prop.Name)) {
            $merged[$prop.Name] = $prop.Value
            $restored += $prop.Name
        }
    }

    if ($restored.Count -gt 0) {
        New-Item -ItemType Directory -Path (Split-Path $settingsPath) -Force | Out-Null
        $merged | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8
        Write-Host "Restored $($restored.Count) setting(s) that were missing after update: $($restored -join ', ')"
    }
    else {
        Write-Host "Settings intact — nothing to restore."
    }
}
