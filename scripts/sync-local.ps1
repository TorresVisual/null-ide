<#
.SYNOPSIS
    Syncs compiled extensions and custom Null IDE assets into one or more
    already-installed Null IDE instances.

.DESCRIPTION
    This script performs a local development sync without running the full
    CI/release build.

    By default it syncs:
      - Built-in extensions
      - Workbench CSS + splash JS
      - Media assets
      - null-setup.exe + registration script

    Optional:
      - -Icons       Win32 icons + VisualElementsManifest
      - -ProductJson Merge repository product.json while preserving
                     build-stamped/upstream fields
      - -ExeIcon     Stamp the installed executable with the Null icon
      - -Full        Enable all optional operations

    Multiple known Null IDE installations are synchronized by default.

.NOTES
    Run this script from the repository's scripts directory.
#>

[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Null IDE",

    [switch]$Full,
    [switch]$Icons,
    [switch]$ProductJson,
    [switch]$ExeIcon
)

# ============================================================
# CONFIGURATION
# ============================================================

$ErrorActionPreference = "Stop"

if ($Full) {
    $Icons = $true
    $ProductJson = $true
    $ExeIcon = $true
}

# ============================================================
# HELPERS
# ============================================================

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "==> $Message"
}

function Test-NullIdeRunning {
    param(
        [string]$Destination
    )

    $processes = Get-Process -Name "null" -ErrorAction SilentlyContinue

    if (-not $processes) {
        return $false
    }

    $destinationFullPath =
        [System.IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'

    foreach ($process in $processes) {
        try {
            $processPath = $process.MainModule.FileName

            if (
                $processPath -and
                $processPath.StartsWith(
                    $destinationFullPath,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            ) {
                return $true
            }
        }
        catch {
            # Access to MainModule can fail for some processes.
            # Fall back to checking whether the installation contains null.exe.
            if (Test-Path (Join-Path $Destination "null.exe")) {
                return $true
            }
        }
    }

    return $false
}

function Copy-ExtensionPath {
    param(
        [string]$SourceRoot,
        [string]$DestRoot,
        [string]$RelativePath
    )

    $source = Join-Path $SourceRoot $RelativePath

    if (-not (Test-Path $source)) {
        Write-Warning "Source path missing: $source"
        return
    }

    $dest = Join-Path $DestRoot $RelativePath

    if ((Get-Item $source).PSIsContainer) {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null

        robocopy `
            $source `
            $dest `
            /MIR `
            /R:2 `
            /W:2 `
            /NFL `
            /NDL `
            /NJH `
            /NJS `
            /NP | Out-Null

        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed copying '$source' to '$dest' (exit $LASTEXITCODE)."
        }
    }
    else {
        $destParent = Split-Path -Parent $dest

        New-Item `
            -ItemType Directory `
            -Path $destParent `
            -Force | Out-Null

        Copy-Item `
            -LiteralPath $source `
            -Destination $dest `
            -Force
    }
}

# ============================================================
# REPOSITORY PATHS
# ============================================================

$repoRoot = Split-Path -Parent $PSScriptRoot

$extensionsSrc = Join-Path $repoRoot "extensions"

$nullSetupExe =
    Join-Path $repoRoot "setup\target\release\null-setup.exe"

$rcedit =
    Join-Path $PSScriptRoot "rcedit-tool\node_modules\rcedit\bin\rcedit.exe"

# ============================================================
# INSTALL TARGETS
# ============================================================

# Always include the explicitly supplied/default installation.
# The additional paths retain compatibility with the previous script,
# which synchronized multiple local Null IDE installations.
$targets = @(
    $InstallDir,
    "$env:LOCALAPPDATA\Programs\Null IDE",
    "C:\Users\Moritz\AppData\Local\Programs\Null IDE",
    "C:\Users\Torres\AppData\Local\Programs\Null IDE"
) |
    Where-Object { $_ } |
    ForEach-Object {
        try {
            [System.IO.Path]::GetFullPath($_)
        }
        catch {
            $_
        }
    } |
    Select-Object -Unique

# ============================================================
# EXTENSIONS
# ============================================================

# name -> compile step + paths copied into the installed extension
#
# node_modules and source files are intentionally NOT copied.
# Compiled extensions use their existing installed node_modules.
$Extensions = [ordered]@{
    "null-theme" = @{
        Compile = $false
        Copy    = @(
            "package.json",
            "themes"
        )
    }

    "null-icons" = @{
        Compile = $false
        Copy    = @(
            "package.json",
            "src"
        )
    }

    "null-markdown" = @{
        Compile = $false
        Copy    = @(
            "package.json",
            "extension.js",
            "editorProvider.js",
            "pages.js",
            "docActions.js",
            "syncState.js",
            "imageSrc.js",
            "preview",
            "lib"
        )
    }

    "null-tools" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "lib",
            "media"
        )
    }

    "null-cpp" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out"
        )
    }

    "null-actions" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "lib"
        )
    }

    "null-accounts" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "media"
        )
    }

    "null-format" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "defaults",
            "node_modules"
        )
    }

    "null-music" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "lib",
            "media"
        )
    }

    "null-activity" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "lib",
            "media"
        )
    }

    "null-startup" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "lib"
        )
    }

    "null-env" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out"
        )
    }

    "null-sync" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "node_modules/jsonc-parser"
        )
    }

}

# ============================================================
# PRODUCT.JSON PRESERVATION
# ============================================================

# These are stamped by the actual build or owned by upstream.
# Local syncing must never overwrite them.
$preserveProductFields =
    [System.Collections.Generic.HashSet[string]]@(
        'version',
        'release',
        'commit',
        'date',
        'checksums',

        'builtInExtensions',
        'builtInExtensionsEnabledWithAutoUpdates',

        'webviewContentExternalBaseUrlTemplate',

        'defaultChatAgent',
        'trustedExtensionAuthAccess',

        'onboardingKeymaps',
        'onboardingExtensions',
        'onboardingThemes',

        'licenseName',
        'licenseUrl',
        'serverLicenseUrl',

        'serverGreeting',
        'serverLicense',
        'serverLicensePrompt',

        'licenseFileName',

        'darwinProfileUUID',
        'darwinProfilePayloadUUID',

        'nodejsRepository'
    )

# ============================================================
# TARGET LOOP
# ============================================================

foreach ($installFullPath in $targets) {

    $installFullPath =
        [System.IO.Path]::GetFullPath($installFullPath)

    $app = Join-Path $installFullPath "resources\app"

    if (-not (Test-Path $app)) {
        Write-Host ""
        Write-Host "Skipping missing: $installFullPath"
        continue
    }

    $installExtensionsDir =
        Join-Path $app "extensions"

    Write-Host ""
    Write-Host "============================================================"
    Write-Host "Syncing -> $installFullPath"
    Write-Host "============================================================"

    # --------------------------------------------------------
    # Running IDE check
    # --------------------------------------------------------

    $nullIdeRunning =
        Test-NullIdeRunning -Destination $installFullPath

    if ($nullIdeRunning) {
        Write-Warning "Null IDE is running. Files will sync underneath it."
        Write-Warning "Run scripts\reload-local.ps1 afterward -- 'Developer: Reload Window' serves stale workbench CSS/JS from Chromium's disk cache."
    }

    # --------------------------------------------------------
    # Validate installation
    # --------------------------------------------------------

    if (-not (Test-Path $installExtensionsDir)) {
        Write-Warning "Extensions directory not found: $installExtensionsDir"
        continue
    }

    # ========================================================
    # 1. EXTENSIONS
    # ========================================================

    Write-Step "Syncing extensions"

    foreach ($name in $Extensions.Keys) {

        $info = $Extensions[$name]

        $srcDir =
            Join-Path $extensionsSrc $name

        $destDir =
            Join-Path $installExtensionsDir $name

        Write-Host "  -> $name"

        if (-not (Test-Path $srcDir)) {
            Write-Warning "$name - source directory missing: $srcDir"
            continue
        }

        # ----------------------------------------------------
        # Native addon validation
        # ----------------------------------------------------

        if ($info.NativeCheck) {

            $nativeAddon =
                Get-ChildItem `
                    -Path (Join-Path $srcDir "native") `
                    -Filter "*.node" `
                    -File `
                    -ErrorAction SilentlyContinue

            if (-not $nativeAddon) {
                Write-Warning `
                    "$name - native addon not built. " +
                    "extensions/$name/native/*.node missing. " +
                    "Run extensions/$name/setup.ps1 first. Skipping."

                continue
            }
        }

        # ----------------------------------------------------
        # node_modules validation
        # ----------------------------------------------------

        if ($info.Compile) {

            $nodeModules =
                Join-Path $srcDir "node_modules"

            if (-not (Test-Path $nodeModules)) {
                Write-Warning `
                    "$name - node_modules missing. " +
                    "Run 'npm ci' in extensions/$name first. Skipping."

                continue
            }
        }

        try {

            # ------------------------------------------------
            # Compile
            # ------------------------------------------------

            if ($info.Compile) {

                Push-Location $srcDir

                try {
                    Write-Host "     npm run $($info.CompileScript)"

                    npm run $info.CompileScript

                    if ($LASTEXITCODE -ne 0) {
                        throw `
                            "$name - npm run $($info.CompileScript) failed " +
                            "(exit $LASTEXITCODE)."
                    }
                }
                finally {
                    Pop-Location
                }
            }

            # ------------------------------------------------
            # Copy selected extension files
            # ------------------------------------------------

            foreach ($relativePath in $info.Copy) {

                Copy-ExtensionPath `
                    -SourceRoot $srcDir `
                    -DestRoot $destDir `
                    -RelativePath $relativePath
            }

            # ------------------------------------------------
            # Native .node files
            # ------------------------------------------------

            if ($info.NativeCheck) {

                $destNative =
                    Join-Path $destDir "native"

                New-Item `
                    -ItemType Directory `
                    -Path $destNative `
                    -Force |
                    Out-Null

                Get-ChildItem `
                    -Path (Join-Path $srcDir "native") `
                    -Filter "*.node" `
                    -File |
                    ForEach-Object {

                        Copy-Item `
                            -LiteralPath $_.FullName `
                            -Destination $destNative `
                            -Force
                    }
            }

            Write-Host "     [ok] $name"

        }
        catch {

            Write-Warning `
                "$name - sync failed, skipping: $($_.Exception.Message)"
        }
    }

    # ========================================================
    # 2. WORKBENCH
    # ========================================================

    Write-Step "Syncing workbench assets"

    $workbenchDestDir =
        Join-Path $app "out\vs\code\electron-browser\workbench"

    if (Test-Path $workbenchDestDir) {

        Copy-Item `
            -LiteralPath (Join-Path $repoRoot "workbench\custom.css") `
            -Destination (Join-Path $workbenchDestDir "null-custom.css") `
            -Force

        Copy-Item `
            -LiteralPath (Join-Path $repoRoot "workbench\splash.js") `
            -Destination (Join-Path $workbenchDestDir "null-splash.js") `
            -Force

        Write-Host "  [ok] workbench CSS + splash JS"
    }
    else {
        Write-Warning `
            "Workbench directory not found: $workbenchDestDir"
    }

    # ========================================================
    # 3. MEDIA
    # ========================================================

    Write-Step "Syncing media assets"

    $media =
        Join-Path $app "out\media"

    if (Test-Path $media) {

        Copy-Item `
            (Join-Path $repoRoot "workbench\letterpress-dark.svg") `
            (Join-Path $media "letterpress-dark.svg") `
            -Force

        Copy-Item `
            (Join-Path $repoRoot "workbench\letterpress-dark.svg") `
            (Join-Path $media "letterpress-hcDark.svg") `
            -Force

        Copy-Item `
            (Join-Path $repoRoot "workbench\letterpress-light.svg") `
            (Join-Path $media "letterpress-light.svg") `
            -Force

        Copy-Item `
            (Join-Path $repoRoot "workbench\letterpress-light.svg") `
            (Join-Path $media "letterpress-hcLight.svg") `
            -Force

        Copy-Item `
            (Join-Path $repoRoot "icons\icon.svg") `
            (Join-Path $media "code-icon.svg") `
            -Force

        Write-Host "  [ok] letterpress + code-icon SVGs"
    }
    else {
        Write-Warning "Media directory not found: $media"
    }

    # ========================================================
    # 4. UPDATER
    # ========================================================

    Write-Step "Syncing null-setup"

    $updaterDir =
        Join-Path $app "null-updater"

    New-Item `
        -ItemType Directory `
        -Path $updaterDir `
        -Force |
        Out-Null

    Copy-Item `
        (Join-Path $repoRoot "scripts\install-null-ide.ps1") `
        $updaterDir `
        -Force

    if (Test-Path $nullSetupExe) {

        $setupDir =
            Join-Path $installFullPath "setup"

        New-Item `
            -ItemType Directory `
            -Path $setupDir `
            -Force |
            Out-Null

        Copy-Item `
            $nullSetupExe `
            $setupDir `
            -Force

        Write-Host "  [ok] registration script + setup\null-setup.exe"
    }
    else {
        Write-Host "  [ok] registration script"
        Write-Warning `
            "null-setup.exe not built: $nullSetupExe"
    }

    # ========================================================
    # 5. OPTIONAL ICONS
    # ========================================================

    if ($Icons) {

        Write-Step "Syncing win32 icons"

        $win32 =
            Join-Path $installFullPath "resources\win32"

        if (Test-Path $win32) {

            foreach ($name in @(
                "null",
                "code",
                "codium",
                "vscodium"
            )) {

                Copy-Item `
                    (Join-Path $repoRoot "icons\icon.ico") `
                    (Join-Path $win32 "$name.ico") `
                    -Force
            }

            Copy-Item `
                (Join-Path $repoRoot "icons\icon_150x150.png") `
                (Join-Path $win32 "code_150x150.png") `
                -Force

            Copy-Item `
                (Join-Path $repoRoot "icons\icon_70x70.png") `
                (Join-Path $win32 "code_70x70.png") `
                -Force

            Write-Host "  [ok] win32 icons"
        }
        else {
            Write-Warning `
                "win32 resources directory not found: $win32"
        }

        # ----------------------------------------------------
        # VisualElementsManifest
        # ----------------------------------------------------

        $manifest =
            Join-Path $repoRoot "installer\Null.VisualElementsManifest.xml"

        if (Test-Path $manifest) {

            Copy-Item `
                $manifest `
                (Join-Path $installFullPath "Null.VisualElementsManifest.xml") `
                -Force

            Write-Host "  [ok] VisualElementsManifest"
        }
        else {
            Write-Warning "VisualElementsManifest not found: $manifest"
        }
    }

    # ========================================================
    # 6. OPTIONAL PRODUCT.JSON
    # ========================================================

    if ($ProductJson) {

        Write-Step "Merging product.json"

        $productPath =
            Join-Path $app "product.json"

        $overlayPath =
            Join-Path $repoRoot "product.json"

        if (Test-Path $productPath) {

            if (-not (Test-Path $overlayPath)) {
                Write-Warning `
                    "Repository product.json not found: $overlayPath"
            }
            else {

                $installed =
                    [System.IO.File]::ReadAllText($productPath) |
                    ConvertFrom-Json

                $overlay =
                    [System.IO.File]::ReadAllText($overlayPath) |
                    ConvertFrom-Json

                # ------------------------------------------------
                # Merge overlay while preserving build fields
                # ------------------------------------------------

                foreach ($key in $overlay.PSObject.Properties.Name) {

                    if ($preserveProductFields.Contains($key)) {
                        continue
                    }

                    if ($installed.PSObject.Properties.Name -contains $key) {

                        $installed.$key = $overlay.$key
                    }
                    else {

                        $installed |
                            Add-Member `
                                -MemberType NoteProperty `
                                -Name $key `
                                -Value $overlay.$key `
                                -Force
                    }
                }

                # ------------------------------------------------
                # Fix double-brace AppId artifacts
                # ------------------------------------------------

                foreach ($field in @(
                    'win32x64UserAppId',
                    'win32arm64AppId',
                    'win32arm64UserAppId'
                )) {

                    if ($installed.PSObject.Properties.Name -contains $field) {

                        $installed.$field =
                            $installed.$field -replace '^\{\{', '{'
                    }
                }

                # ------------------------------------------------
                # Fix insider -> stable webview URL
                # ------------------------------------------------

                $wvKey =
                    'webviewContentExternalBaseUrlTemplate'

                if ($installed.PSObject.Properties.Name -contains $wvKey) {

                    $installed.$wvKey =
                        $installed.$wvKey -replace '/insider/', '/stable/'
                }

                # ------------------------------------------------
                # Ensure release exists
                # ------------------------------------------------

                if (-not (
                    $installed.PSObject.Properties.Name -contains 'release'
                )) {

                    $installed |
                        Add-Member `
                            -MemberType NoteProperty `
                            -Name 'release' `
                            -Value $installed.version `
                            -Force
                }

                # ------------------------------------------------
                # Write UTF-8 without BOM
                # ------------------------------------------------

                $json =
                    $installed | ConvertTo-Json -Depth 10

                [System.IO.File]::WriteAllText(
                    $productPath,
                    $json,
                    [System.Text.UTF8Encoding]::new($false)
                )

                Write-Host "  [ok] product.json"
            }
        }
        else {
            Write-Warning `
                "Installed product.json not found: $productPath"
        }
    }

    # ========================================================
    # 7. OPTIONAL EXE ICON
    # ========================================================

    if ($ExeIcon) {

        Write-Step "Stamping .exe icon"

        $exe =
            Get-ChildItem `
                $installFullPath `
                -Filter "*.exe" `
                -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -notmatch 'unins'
            } |
            Select-Object -First 1

        if (-not (Test-Path $rcedit)) {

            Write-Warning `
                "rcedit not found at '$rcedit'."

            Write-Warning `
                "Run 'npm install rcedit --prefix scripts\rcedit-tool' first."

        }
        elseif (-not $exe) {

            Write-Warning `
                "No .exe found under '$installFullPath'."

        }
        elseif (
            Get-Process `
                -Name $exe.BaseName `
                -ErrorAction SilentlyContinue
        ) {

            Write-Warning `
                "Close $($exe.Name) and re-run with -ExeIcon."

        }
        else {

            & $rcedit `
                $exe.FullName `
                --set-icon (Join-Path $repoRoot "icons\icon.ico") |
                Out-Null

            Write-Host `
                "  [ok] exe icon stamped ($($exe.Name))"
        }
    }

    # ========================================================
    # TARGET COMPLETE
    # ========================================================

    Write-Host ""
    Write-Host "Sync complete: $installFullPath"

    if ($nullIdeRunning) {
        Write-Host "Run scripts\reload-local.ps1 to pick up the change (a plain window reload can serve stale cached CSS/JS)."
    }
}

# ============================================================
# COMPLETE
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "Done."
Write-Host "============================================================"

if (-not ($Icons -and $ProductJson -and $ExeIcon)) {

    Write-Host ""
    Write-Host `
        "Optional: use -Full to also sync icons, product.json, and the .exe icon."
}
