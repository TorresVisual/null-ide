<#
Syncs compiled extension output and workbench assets from this repo into an
already-installed local Null IDE, without running the full CI build.

Does NOT touch shell-ext/, product.json, or icons — those still need a real
release build (see .github/workflows/build.yml).
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Null IDE"
)

$ErrorActionPreference = "Stop"

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

if (Test-NullIdeRunning -Destination $installFullPath) {
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

Write-Host ""
Write-Host "Sync complete: $installFullPath"
Write-Host "In Null IDE, run 'Developer: Reload Window' to pick up the changes."
Write-Host "Note: shell-ext/, product.json, and icons are not synced by this script - those need a full CI build."
