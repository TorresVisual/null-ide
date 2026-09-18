<#
Syncs compiled extension output and workbench assets from this repo into an
already-installed local Null IDE, without running the full CI build.

By default this does NOT touch shell-ext/, product.json, or icons — those
normally come from a real release build (see .github/workflows/build.yml).
Pass -Full (or the individual -Icons/-ProductJson/-ExeIcon switches) to also
sync those, mirroring what a release build would stamp into the install.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Null IDE",
    [switch]$Full,
    [switch]$Icons,
    [switch]$ProductJson,
    [switch]$ExeIcon
)

$ErrorActionPreference = "Stop"

if ($Full) { $Icons = $true; $ProductJson = $true; $ExeIcon = $true }

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
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

function Copy-ExtensionPath {
    param(
        [string]$SourceRoot,
        [string]$DestRoot,
        [string]$RelativePath
    )

    $source = Join-Path $SourceRoot $RelativePath
    if (-not (Test-Path $source)) {
        return
    }

    $dest = Join-Path $DestRoot $RelativePath

    if ((Get-Item $source).PSIsContainer) {
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        robocopy $source $dest /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) {
            throw "robocopy failed copying '$source' to '$dest' (exit $LASTEXITCODE)."
        }
    }
    else {
        $destParent = Split-Path -Parent $dest
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $dest -Force
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionsSrc = Join-Path $repoRoot "extensions"
$installFullPath = [System.IO.Path]::GetFullPath($InstallDir)
$installExtensionsDir = Join-Path $installFullPath "resources\app\extensions"

if (-not (Test-Path $installExtensionsDir)) {
    throw "Null IDE install not found at '$installFullPath'. Run scripts/install-null-ide.ps1 first."
}

$nullIdeRunning = Test-NullIdeRunning -Destination $installFullPath
if ($nullIdeRunning) {
    Write-Warning "Null IDE is running. Files will sync underneath it - reload the window afterward to pick up changes."
}

# name -> compile step + subpaths to copy into resources\app\extensions\<name>\ afterward
$Extensions = [ordered]@{
    "null-theme"     = @{ Compile = $false; Copy = @("package.json", "themes") }
    "null-icons"     = @{ Compile = $false; Copy = @("package.json", "src") }
    "null-markdown"  = @{ Compile = $false; Copy = @("package.json", "extension.js", "preview") }
    "null-tools"     = @{ Compile = $true;  CompileScript = "compile"; Copy = @("package.json", "out", "lib") }
    "null-cpp"       = @{ Compile = $true;  CompileScript = "compile"; Copy = @("package.json", "out") }
    "null-actions"   = @{ Compile = $true;  CompileScript = "compile"; Copy = @("package.json", "out", "lib") }
    "wooting-analog" = @{ Compile = $true;  CompileScript = "build";   Copy = @("package.json", "out"); NativeCheck = $true }
}

foreach ($name in $Extensions.Keys) {
    $info = $Extensions[$name]
    $srcDir = Join-Path $extensionsSrc $name
    $destDir = Join-Path $installExtensionsDir $name

    Write-Step "Syncing $name"

    if ($info.NativeCheck) {
        $nativeAddon = Get-ChildItem -Path (Join-Path $srcDir "native") -Filter "*.node" -File -ErrorAction SilentlyContinue
        if (-not $nativeAddon) {
            Write-Warning "$name - native addon not built (extensions/$name/native/*.node missing). Run extensions/$name/setup.ps1 first. Skipping."
            continue
        }
    }

    if ($info.Compile) {
        $nodeModules = Join-Path $srcDir "node_modules"
        if (-not (Test-Path $nodeModules)) {
            Write-Warning "$name - node_modules missing. Run 'npm ci' in extensions/$name first. Skipping."
            continue
        }
    }

    try {
        if ($info.Compile) {
            Push-Location $srcDir
            try {
                npm run $info.CompileScript
                if ($LASTEXITCODE -ne 0) {
                    throw "$name - npm run $($info.CompileScript) failed (exit $LASTEXITCODE)."
                }
            }
            finally {
                Pop-Location
            }
        }

        foreach ($relativePath in $info.Copy) {
            Copy-ExtensionPath -SourceRoot $srcDir -DestRoot $destDir -RelativePath $relativePath
        }

        if ($info.NativeCheck) {
            $destNative = Join-Path $destDir "native"
            New-Item -ItemType Directory -Path $destNative -Force | Out-Null
            Get-ChildItem -Path (Join-Path $srcDir "native") -Filter "*.node" -File |
                ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destNative -Force }
        }
    }
    catch {
        Write-Warning "$name - sync failed, skipping: $($_.Exception.Message)"
        continue
    }
}

Write-Step "Syncing workbench assets"
$workbenchDestDir = Join-Path $installFullPath "resources\app\out\vs\code\electron-browser\workbench"
if (Test-Path $workbenchDestDir) {
    Copy-Item -LiteralPath (Join-Path $repoRoot "workbench\custom.css") -Destination (Join-Path $workbenchDestDir "null-custom.css") -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot "workbench\splash.js") -Destination (Join-Path $workbenchDestDir "null-splash.js") -Force
}
else {
    Write-Warning "Workbench directory not found at '$workbenchDestDir' - skipping custom.css/splash.js sync."
}

if ($Icons) {
    Write-Step "Syncing win32 icons"
    $win32 = Join-Path $installFullPath "resources\win32"
    if (Test-Path $win32) {
        foreach ($name in @("null", "code", "codium", "vscodium")) {
            Copy-Item -LiteralPath (Join-Path $repoRoot "icons\icon.ico") -Destination (Join-Path $win32 "$name.ico") -Force
        }
        Copy-Item -LiteralPath (Join-Path $repoRoot "icons\icon_150x150.png") -Destination (Join-Path $win32 "code_150x150.png") -Force
        Copy-Item -LiteralPath (Join-Path $repoRoot "icons\icon_70x70.png")   -Destination (Join-Path $win32 "code_70x70.png")   -Force
    }
    else {
        Write-Warning "win32 resources dir not found at '$win32' - skipping icon sync."
    }

    Copy-Item -LiteralPath (Join-Path $repoRoot "installer\Null.VisualElementsManifest.xml") `
        -Destination (Join-Path $installFullPath "Null.VisualElementsManifest.xml") -Force
}

if ($ProductJson) {
    Write-Step "Merging product.json"
    $productPath = Join-Path $installFullPath "resources\app\product.json"
    if (Test-Path $productPath) {
        # Fields stamped at build time or owned by upstream -- never overwrite these with
        # the repo's dev-time overlay, unlike the CI build path (build.yml stamps these
        # itself, after the merge, so overwriting there is fine; here it would blow away
        # the installed build's real version/checksums).
        $preserve = [System.Collections.Generic.HashSet[string]]@(
            'version', 'release', 'commit', 'date', 'checksums',
            'builtInExtensions', 'builtInExtensionsEnabledWithAutoUpdates',
            'webviewContentExternalBaseUrlTemplate',
            'defaultChatAgent', 'trustedExtensionAuthAccess',
            'onboardingKeymaps', 'onboardingExtensions', 'onboardingThemes',
            'licenseName', 'licenseUrl', 'serverLicenseUrl',
            'serverGreeting', 'serverLicense', 'serverLicensePrompt',
            'licenseFileName', 'darwinProfileUUID', 'darwinProfilePayloadUUID',
            'nodejsRepository'
        )

        $installed = [System.IO.File]::ReadAllText($productPath) | ConvertFrom-Json
        $overlay   = [System.IO.File]::ReadAllText((Join-Path $repoRoot "product.json")) | ConvertFrom-Json

        foreach ($key in $overlay.PSObject.Properties.Name) {
            if ($preserve.Contains($key)) { continue }
            if ($installed.PSObject.Properties.Name -contains $key) {
                $installed.$key = $overlay.$key
            } else {
                $installed | Add-Member -MemberType NoteProperty -Name $key -Value $overlay.$key -Force
            }
        }

        # Fix double-brace AppId artifacts from VSCodium source product.json
        foreach ($field in @('win32x64UserAppId', 'win32arm64AppId', 'win32arm64UserAppId')) {
            if ($installed.PSObject.Properties.Name -contains $field) {
                $installed.$field = $installed.$field -replace '^\{\{', '{'
            }
        }

        # Fix webview URL quality: insider -> stable
        $wvKey = 'webviewContentExternalBaseUrlTemplate'
        if ($installed.PSObject.Properties.Name -contains $wvKey) {
            $installed.$wvKey = $installed.$wvKey -replace '/insider/', '/stable/'
        }

        # Ensure release mirrors version if missing
        if (-not ($installed.PSObject.Properties.Name -contains 'release')) {
            $installed | Add-Member -MemberType NoteProperty -Name 'release' -Value $installed.version -Force
        }

        $json = $installed | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($productPath, $json, [System.Text.UTF8Encoding]::new($false))
    }
    else {
        Write-Warning "product.json not found at '$productPath' - skipping merge."
    }
}

if ($ExeIcon) {
    Write-Step "Stamping .exe icon"
    $rcedit = Join-Path $PSScriptRoot "rcedit-tool\node_modules\rcedit\bin\rcedit.exe"
    $exe    = Get-ChildItem $installFullPath -Filter "*.exe" -ErrorAction SilentlyContinue |
              Where-Object { $_.Name -notmatch 'unins' } | Select-Object -First 1
    if (-not (Test-Path $rcedit)) {
        Write-Warning "rcedit not found at '$rcedit' - run 'npm install rcedit --prefix scripts\rcedit-tool' first. Skipping."
    }
    elseif (-not $exe) {
        Write-Warning "No .exe found under '$installFullPath' - skipping."
    }
    elseif (Get-Process -Name $exe.BaseName -ErrorAction SilentlyContinue) {
        Write-Warning "Close $($exe.Name) and re-run with -ExeIcon to stamp its icon."
    }
    else {
        & $rcedit $exe.FullName --set-icon (Join-Path $repoRoot "icons\icon.ico") | Out-Null
        Write-Host "  [ok] exe icon stamped ($($exe.Name))"
    }
}

Write-Host ""
Write-Host "Sync complete: $installFullPath"
Write-Host "In Null IDE, run 'Developer: Reload Window' to pick up the changes."
if (-not ($Icons -and $ProductJson -and $ExeIcon)) {
    Write-Host "Note: pass -Full (or -Icons/-ProductJson/-ExeIcon) to also sync icons, product.json, and the .exe icon."
}
