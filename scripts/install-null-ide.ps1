[CmdletBinding()]
param(
    [string]$Repo = "TorresVisual/null-ide",
    [string]$Version = "latest",
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Null IDE",
    [string]$ZipPath,
    [switch]$IncludePrerelease,
    [switch]$Force,
    [switch]$NoDesktopShortcut,
    [switch]$NoStartMenuShortcut,
    [switch]$NoContextMenu,
    [switch]$RegisterContextMenu,
    [switch]$Launch
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
        "User-Agent"           = "Null-IDE-Installer"
    }

    if ($env:GITHUB_TOKEN) {
        $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
    }

    Invoke-RestMethod -Uri $Uri -Headers $headers
}

function Get-Release {
    param(
        [string]$RepoName,
        [string]$RequestedVersion,
        [bool]$AllowPrerelease
    )

    $base = "https://api.github.com/repos/$RepoName/releases"

    if ($RequestedVersion -ne "latest") {
        return Invoke-GitHubJson "$base/tags/$RequestedVersion"
    }

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

function Get-ReleaseAsset {
    param($Release)

    $asset = $Release.assets |
        Where-Object { $_.name -match '^null-ide-win32-x64.*\.zip$' } |
        Select-Object -First 1

    if (-not $asset) {
        throw "Release '$($Release.tag_name)' does not contain a null-ide-win32-x64*.zip asset."
    }

    $asset
}

function Test-NullIdeRunning {
    param([string]$Destination)

    $processes = Get-Process -Name "null" -ErrorAction SilentlyContinue
    if (-not $processes) {
        return $false
    }

    $destinationFullPath = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'

    foreach ($process in $processes) {
        try {
            $processPath = $process.MainModule.FileName
            if ($processPath -and $processPath.StartsWith($destinationFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        }
        catch {
            if (Test-Path (Join-Path $Destination "null.exe")) {
                return $true
            }
        }
    }

    return $false
}

function New-Shortcut {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$WorkingDirectory
    )

    $parent = Split-Path -Parent $ShortcutPath
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.IconLocation = "$TargetPath,0"
    $shortcut.Save()
}

function Register-ContextMenu {
    param([string]$ExePath)

    $cmd = "`"$ExePath`" `"%1`""
    $cmdBg = "`"$ExePath`" `"%V`""

    $entries = @(
        @{ Key = 'HKCU:\Software\Classes\*\shell\NullIDE';                    Label = 'Open in Null';          Cmd = $cmd   }
        @{ Key = 'HKCU:\Software\Classes\Directory\shell\NullIDE';            Label = 'Open Folder in Null';   Cmd = $cmd   }
        @{ Key = 'HKCU:\Software\Classes\Directory\Background\shell\NullIDE'; Label = 'Open Folder in Null';   Cmd = $cmdBg }
    )

    foreach ($entry in $entries) {
        New-Item -Path $entry.Key -Force | Out-Null
        Set-ItemProperty -Path $entry.Key -Name '(default)' -Value $entry.Label
        Set-ItemProperty -Path $entry.Key -Name 'Icon'      -Value "$ExePath,0"
        New-Item -Path "$($entry.Key)\command" -Force | Out-Null
        Set-ItemProperty -Path "$($entry.Key)\command" -Name '(default)' -Value $entry.Cmd
    }
}

function Unregister-ContextMenu {
    $keys = @(
        'HKCU:\Software\Classes\*\shell\NullIDE'
        'HKCU:\Software\Classes\Directory\shell\NullIDE'
        'HKCU:\Software\Classes\Directory\Background\shell\NullIDE'
    )
    foreach ($key in $keys) {
        if (Test-Path $key) {
            Remove-Item -Path $key -Recurse -Force
        }
    }
}

function Set-DefaultSettings {
    $settingsDir = Join-Path $env:APPDATA "Null\User"
    $settingsPath = Join-Path $settingsDir "settings.json"

    $defaults = [ordered]@{
        "workbench.colorTheme"                       = "Null Dark"
        "workbench.iconTheme"                        = "null-icons"
        "window.titleBarStyle"                       = "custom"
        "window.menuBarVisibility"                   = "compact"
        "telemetry.telemetryLevel"                   = "off"
        "update.mode"                                = "none"
        "update.showReleaseNotes"                    = $false
        "extensions.autoCheckUpdates"                = $false
        "security.workspace.trust.untrustedFiles"    = "open"
        "security.workspace.trust.enabled"           = $false
        "workbench.enableExperiments"                = $false
    }

    New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null

    $existing = [ordered]@{}
    if (Test-Path $settingsPath) {
        try {
            $raw = Get-Content $settingsPath -Raw -Encoding UTF8
            $parsed = $raw | ConvertFrom-Json
            foreach ($prop in $parsed.PSObject.Properties) {
                $existing[$prop.Name] = $prop.Value
            }
        }
        catch {
            Write-Warning "Could not parse existing settings.json - leaving it untouched."
            return
        }
    }

    $changed = $false
    foreach ($key in $defaults.Keys) {
        if (-not $existing.Contains($key)) {
            $existing[$key] = $defaults[$key]
            $changed = $true
        }
    }

    if ($changed) {
        $existing | ConvertTo-Json -Depth 10 | Set-Content $settingsPath -Encoding UTF8
        Write-Host "Seeded default settings into $settingsPath"
    }
}

function Install-Zip {
    param(
        [string]$SourceZip,
        [string]$Destination,
        [string]$InstalledVersion,
        [string]$Repository
    )

    if (Test-NullIdeRunning -Destination $Destination) {
        throw "Null IDE is running. Close null.exe before installing or updating."
    }

    $destinationFullPath = [System.IO.Path]::GetFullPath($Destination)
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("null-ide-install-" + [guid]::NewGuid())
    $extractDir = Join-Path $tempRoot "extract"
    $backupDir = Join-Path $tempRoot "backup"

    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    try {
        Write-Step "Extracting package"
        Expand-Archive -Path $SourceZip -DestinationPath $extractDir -Force

        $exe = Get-ChildItem -Path $extractDir -Filter "null.exe" -Recurse -File |
            Sort-Object { $_.FullName.Length } |
            Select-Object -First 1

        if (-not $exe) {
            throw "The package does not contain null.exe."
        }

        $packageRoot = $exe.Directory.FullName
        New-Item -ItemType Directory -Path $destinationFullPath -Force | Out-Null

        $existingItems = Get-ChildItem -LiteralPath $destinationFullPath -Force -ErrorAction SilentlyContinue
        if ($existingItems -and -not $Force) {
            throw "Install directory is not empty: $destinationFullPath. Re-run with -Force to replace app files."
        }

        if ($existingItems) {
            Write-Step "Backing up current app files"
            New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
            foreach ($item in $existingItems) {
                if ($item.Name -eq "data" -or $item.Name -like "unins*") {
                    continue
                }

                Move-Item -LiteralPath $item.FullName -Destination $backupDir -Force
            }
        }

        Write-Step "Installing to $destinationFullPath"
        Get-ChildItem -LiteralPath $packageRoot -Force | ForEach-Object {
            Move-Item -LiteralPath $_.FullName -Destination $destinationFullPath -Force
        }

        $metadata = [ordered]@{
            repo        = $Repository
            version     = $InstalledVersion
            installedAt = (Get-Date).ToUniversalTime().ToString("o")
            installDir  = $destinationFullPath
        }

        $metadataPath = Join-Path $destinationFullPath ".null-ide-install.json"
        $metadata | ConvertTo-Json | Set-Content -Path $metadataPath -Encoding UTF8

        $target = Join-Path $destinationFullPath "null.exe"

        if (-not $NoDesktopShortcut) {
            Write-Step "Creating desktop shortcut"
            New-Shortcut `
                -ShortcutPath (Join-Path ([Environment]::GetFolderPath("Desktop")) "Null IDE.lnk") `
                -TargetPath $target `
                -WorkingDirectory $destinationFullPath
        }

        if (-not $NoStartMenuShortcut) {
            Write-Step "Creating Start Menu shortcut"
            New-Shortcut `
                -ShortcutPath (Join-Path ([Environment]::GetFolderPath("Programs")) "Null IDE\Null IDE.lnk") `
                -TargetPath $target `
                -WorkingDirectory $destinationFullPath
        }

        if (-not $NoContextMenu) {
            Write-Step "Registering context menu entries"
            Register-ContextMenu -ExePath $target
        }

        Write-Step "Seeding default settings"
        Set-DefaultSettings

        if ($Launch) {
            Write-Step "Launching Null IDE"
            Start-Process -FilePath $target -WorkingDirectory $destinationFullPath
        }

        Write-Host ""
        Write-Host "Null IDE installed: $destinationFullPath"
        Write-Host "Version: $InstalledVersion"
    }
    catch {
        if ((Test-Path $backupDir) -and (Test-Path $destinationFullPath)) {
            Write-Warning "Install failed. Restoring previous app files."
            Get-ChildItem -LiteralPath $destinationFullPath -Force |
                Where-Object { $_.Name -ne "data" -and $_.Name -notlike "unins*" } |
                ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
            Get-ChildItem -LiteralPath $backupDir -Force |
                ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $destinationFullPath -Force }
        }

        throw
    }
    finally {
        if (Test-Path $tempRoot) {
            Remove-Item -LiteralPath $tempRoot -Recurse -Force
        }
    }
}

if ($RegisterContextMenu) {
    $target = Join-Path ([System.IO.Path]::GetFullPath($InstallDir)) "null.exe"
    if (-not (Test-Path $target)) {
        throw "null.exe not found at $target - check -InstallDir."
    }
    Write-Step "Registering context menu entries"
    Register-ContextMenu -ExePath $target
    Write-Host "Done."
    return
}

if ($ZipPath) {
    $zipFullPath = [System.IO.Path]::GetFullPath($ZipPath)
    if (-not (Test-Path $zipFullPath)) {
        throw "ZIP not found: $zipFullPath"
    }

    Install-Zip -SourceZip $zipFullPath -Destination $InstallDir -InstalledVersion "local" -Repository $Repo
    return
}

Write-Step "Resolving release $Version from $Repo"
$release = Get-Release -RepoName $Repo -RequestedVersion $Version -AllowPrerelease $IncludePrerelease.IsPresent
$asset = Get-ReleaseAsset -Release $release

$downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) ("null-ide-download-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
$downloadPath = Join-Path $downloadDir $asset.name

try {
    Write-Step "Downloading $($asset.name)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloadPath
    Install-Zip -SourceZip $downloadPath -Destination $InstallDir -InstalledVersion $release.tag_name -Repository $Repo
}
finally {
    if (Test-Path $downloadDir) {
        Remove-Item -LiteralPath $downloadDir -Recurse -Force
    }
}
