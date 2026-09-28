<#
.SYNOPSIS
    Mirrors the build-windows job in .github/workflows/build.yml so the full
    release pipeline can be iterated on locally instead of via workflow_dispatch.

.DESCRIPTION
    Use this for changes that scripts/sync-local.ps1 can't exercise: build.yml
    itself, shell-ext/, installer/null-ide.iss, or the VSCodium/VS Code
    patch/merge steps. For ordinary extensions/workbench iteration against an
    already-installed Null IDE, use sync-local.ps1 instead - it's minutes
    faster because it skips the VS Code source build entirely.

    Clones VSCodium + VS Code into -WorkspaceDir (this repo's root by
    default — matches .gitignore's existing vscode-src/, vscodium-src/, and
    VSCode-*/ entries, same layout build.yml's job uses). On a second run
    against the same tag, the existing clones are reset and re-cleaned
    (patches re-applied fresh) rather than re-cloned, and vscode-src's
    node_modules is preserved across runs - so repeat iterations skip both
    the clone and the `npm ci` in vscode-src, which are the two slowest
    steps. Pass -Clean to force fresh clones.

.PARAMETER WorkspaceDir
    Where vscodium-src, vscode-src, and build output are staged. Defaults to
    this repo's root (already gitignored). Pass a directory outside the repo
    if you'd rather keep the multi-GB VS Code source tree out of your editor's
    workspace / search index.

.PARAMETER VscodiumTag
    Overrides the pinned tag in VSCODIUM_TAG (same as build.yml's
    workflow_dispatch vscodium_tag input).

.PARAMETER Version
    Version string stamped into the output and used for the installer
    filename. Defaults to the resolved VSCodium tag.

.PARAMETER Clean
    Delete and re-clone vscodium-src/vscode-src instead of reusing them.

.PARAMETER SkipShellExt
    Skip building/signing the Win11 shell extension APPX.

.PARAMETER SkipInstaller
    Skip the Inno Setup installer step (still produces the zip).

.PARAMETER PublishRelease
    After building, tag the current commit -Version (creating and pushing it
    if it doesn't already exist) and publish the zip/checksum/installer to a
    GitHub Release via `gh`, same as build.yml's tag-triggered release step.
    Requires -Version. Prompts for confirmation before doing anything, since
    pushing the tag also triggers the GitHub Actions build for that tag, and
    the release is what the in-app updater on real installs checks.

.NOTES
    Local prerequisites (all verified at startup, none installed for you):
      - Node.js matching vscode-src/.nvmrc (checked after clone)
      - npm
      - Rust stable with the x86_64-pc-windows-msvc target
        (rustup target add x86_64-pc-windows-msvc)
      - CMake
      - Visual Studio 2022 with the "Desktop development with C++" workload
        (provides MSVC, the Windows SDK, signtool.exe and makeappx.exe)
      - Inno Setup 6 (skip with -SkipInstaller if not installed)
      - git, with core.longpaths enabled - if not, this script warns rather
        than changing system git config for you; run once as admin:
          git config --global core.longpaths true

    Run this script from anywhere; paths are resolved relative to the repo
    checkout, not the current directory.
#>

[CmdletBinding()]
param(
    [string]$WorkspaceDir,
    [string]$VscodiumTag,
    [string]$Version,
    [switch]$Clean,
    [switch]$SkipShellExt,
    [switch]$SkipInstaller,
    [switch]$PublishRelease
)

$ErrorActionPreference = "Stop"

# ============================================================
# HELPERS
# ============================================================

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "==> $Message"
}

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][scriptblock]$Command
    )

    # Windows PowerShell 5.1 promotes every stderr line from a native command
    # (e.g. git's routine "trailing whitespace" notes, git clean's warnings)
    # to a terminating ErrorRecord under $ErrorActionPreference = "Stop" (set
    # script-wide, above) - even though it's not a failure. $LASTEXITCODE
    # below is the real signal; stderr text alone shouldn't abort the build.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command
    }
    finally {
        $ErrorActionPreference = $previous
    }

    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed (exit $LASTEXITCODE)."
    }
}

function Test-NodeModulesStale {
    # npm writes node_modules/.package-lock.json as a snapshot of the
    # lockfile it last installed from. A reused clone's preserved
    # node_modules can predate a VSCODIUM_TAG/MS_TAG bump that changed
    # package-lock.json (e.g. @vscode/proxy-agent 0.42.0 -> 0.44.0),
    # silently leaving stale packages installed. Comparing resolved
    # versions against that snapshot is how we detect it needs a real
    # `npm ci` instead of being skipped outright.
    #
    # Compares by package version rather than a whole-file hash because
    # a later `npm install --no-save` step (the @anthropic-ai/sdk pin)
    # legitimately adds extra entries to the snapshot that never appear
    # in package-lock.json - a raw hash diff would always call that stale.
    param([Parameter(Mandatory)][string]$Dir)

    $snapshot = Join-Path $Dir "node_modules/.package-lock.json"
    if (-not (Test-Path $snapshot)) {
        return $true
    }

    $checkScript = @'
const lockfile = require(process.argv[1]);
const snapshot = require(process.argv[2]);
for (const [key, entry] of Object.entries(lockfile.packages)) {
    // Skip the root package entry and optionalDependencies - npm
    // legitimately omits optional packages that don't match the current
    // platform/arch (e.g. darwin/linux variants of native modules), so
    // their absence from the snapshot isn't staleness.
    if (key === '' || entry.optional) continue;
    const installed = snapshot.packages[key];
    if (!installed || installed.version !== entry.version) {
        process.exit(1);
    }
}
process.exit(0);
'@
    node -e $checkScript (Join-Path $Dir "package-lock.json") $snapshot
    return $LASTEXITCODE -ne 0
}

# ============================================================
# PATHS
# ============================================================

$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $WorkspaceDir) {
    $WorkspaceDir = $RepoRoot
}

$WorkspaceDir = [System.IO.Path]::GetFullPath($WorkspaceDir)
New-Item -ItemType Directory -Path $WorkspaceDir -Force | Out-Null

$VscodiumSrc = Join-Path $WorkspaceDir "vscodium-src"
$VscodeSrc   = Join-Path $WorkspaceDir "vscode-src"
$OutDir      = Join-Path $WorkspaceDir "VSCode-win32-x64"

Write-Host "Repo root:      $RepoRoot"
Write-Host "Workspace:      $WorkspaceDir"

# ============================================================
# PREREQUISITE CHECKS
# ============================================================

Write-Step "Checking prerequisites"

foreach ($tool in @("git", "node", "npm", "cmake", "rustc", "cargo")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool not found on PATH. See the prerequisites list in this script's header (Get-Help .\build-local.ps1 -Full)."
    }
}

$rustTargets = & rustup target list --installed 2>$null
if ($rustTargets -notcontains "x86_64-pc-windows-msvc") {
    throw "Rust target x86_64-pc-windows-msvc is not installed. Run: rustup target add x86_64-pc-windows-msvc"
}

$longPaths = git config --get core.longpaths 2>$null
if ($longPaths -ne "true") {
    Write-Warning "git core.longpaths is not enabled. The VS Code source tree has deep paths that can fail to check out."
    Write-Warning "Run once (as admin): git config --global core.longpaths true"
}

$iscc = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
    $isccCmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($isccCmd) { $iscc = $isccCmd.Source }
}

if (-not $SkipInstaller -and -not $iscc) {
    throw "Inno Setup 6 (ISCC.exe) not found under Program Files, Program Files (x86), %LOCALAPPDATA%\Programs, or PATH. Install it, or pass -SkipInstaller."
}

if ($PublishRelease) {
    if (-not $Version) {
        throw "-PublishRelease requires -Version (e.g. -Version v1.2.3) so the release isn't tagged with the upstream VSCodium version by accident."
    }
    if ($SkipInstaller) {
        throw "-PublishRelease and -SkipInstaller can't be combined; the installer is one of the published release assets."
    }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw "-PublishRelease requires the GitHub CLI (gh) on PATH."
    }
    Invoke-Native "gh auth status" { gh auth status }
}

# ============================================================
# RESOLVE VSCODIUM TAG
# ============================================================

Write-Step "Resolving VSCodium tag"

$tag = $VscodiumTag
if (-not $tag) {
    $tag = (Get-Content (Join-Path $RepoRoot "VSCODIUM_TAG") -Raw).Trim()
}

try {
    $latest = (Invoke-RestMethod "https://api.github.com/repos/VSCodium/vscodium/releases/latest").tag_name
    if ($tag -ne $latest) {
        Write-Warning "Building against VSCodium $tag but $latest is available."
    }
}
catch {
    Write-Warning "Could not check for a newer VSCodium release: $($_.Exception.Message)"
}

Write-Host "Building against VSCodium tag: $tag"

# ============================================================
# CLONE / REUSE VSCODIUM + VS CODE SOURCE
# ============================================================

function Get-OrCloneRepo {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RepoUrl,
        [Parameter(Mandatory)][string]$RefTag
    )

    $tagMarker = Join-Path $Path ".build-local-tag"

    $reusable = (-not $Clean) -and
                (Test-Path $Path) -and
                (Test-Path $tagMarker) -and
                ((Get-Content $tagMarker -Raw).Trim() -eq $RefTag)

    if ($reusable) {
        Write-Host "Reusing existing clone at $Path (tag $RefTag)"
        # ponytail: only node_modules survives the reset; gulp/TS incremental
        # caches are not preserved. Add more -e exclusions here if that
        # start-to-finish cost becomes the bottleneck.
        Push-Location $Path
        try {
            Invoke-Native "git reset --hard HEAD" { git reset --hard HEAD }
            Invoke-Native "git clean -fdx (preserving node_modules)" { git clean -fdx -e node_modules -e .build-local-tag }
        }
        finally {
            Pop-Location
        }
        return
    }

    if (Test-Path $Path) {
        Write-Host "Removing stale clone at $Path"
        Remove-Item $Path -Recurse -Force
    }

    Invoke-Native "git clone $RepoUrl" {
        git clone $RepoUrl --depth=1 --branch $RefTag $Path
    }
    Set-Content -Path $tagMarker -Value $RefTag -NoNewline
}

Write-Step "Cloning/reusing VSCodium source"
Get-OrCloneRepo -Path $VscodiumSrc -RepoUrl "https://github.com/VSCodium/vscodium" -RefTag $tag

$msTag = (Get-Content (Join-Path $VscodiumSrc "upstream/stable.json") -Raw | ConvertFrom-Json).tag
Write-Host "Matching VS Code (MS) tag: $msTag"

Write-Step "Cloning/reusing VS Code source"
Get-OrCloneRepo -Path $VscodeSrc -RepoUrl "https://github.com/microsoft/vscode" -RefTag $msTag

# ============================================================
# NODE VERSION CHECK (against vscode-src/.nvmrc)
# ============================================================

$nvmrc = (Get-Content (Join-Path $VscodeSrc ".nvmrc") -Raw).Trim()
$nodeVersion = (node --version).TrimStart("v")
if (-not $nodeVersion.StartsWith($nvmrc)) {
    Write-Warning "vscode-src expects Node $nvmrc (.nvmrc); found $nodeVersion on PATH. Build may fail on native module ABI mismatches."
}

# ============================================================
# PATCHES + PRODUCT.JSON MERGE
# ============================================================

Write-Step "Applying VSCodium patches"
Push-Location $VscodeSrc
try {
    foreach ($dir in @("$VscodiumSrc/patches", "$VscodiumSrc/patches/windows")) {
        Get-ChildItem $dir -Filter *.patch -ErrorAction SilentlyContinue |
            Sort-Object Name |
            ForEach-Object {
                Write-Host "Applying: $($_.Name)"
                Invoke-Native "git apply $($_.Name)" { git apply --ignore-whitespace $_.FullName }
            }
    }

    Write-Step "Applying overlay patches"
    Get-ChildItem (Join-Path $RepoRoot "patches") -Filter *.patch -ErrorAction SilentlyContinue |
        Sort-Object Name |
        ForEach-Object {
            Write-Host "Applying overlay patch: $($_.Name)"
            Invoke-Native "git apply $($_.Name)" { git apply --ignore-whitespace $_.FullName }
        }
}
finally {
    Pop-Location
}

Write-Step "Merging product.json overlay"
Invoke-Native "merge-json.js" {
    node (Join-Path $RepoRoot "scripts/merge-json.js") `
        (Join-Path $VscodeSrc "product.json") `
        (Join-Path $RepoRoot "product.json") `
        (Join-Path $VscodeSrc "product.json")
}

# ============================================================
# COMPILE EXTENSIONS
# ============================================================

Write-Step "Installing null-markdown dependencies"
Invoke-Native "npm ci (null-markdown)" { npm ci --prefix (Join-Path $RepoRoot "extensions/null-markdown") }

foreach ($ext in @("null-tools", "null-cpp", "null-actions", "null-format")) {
    Write-Step "Compiling $ext"
    Push-Location (Join-Path $RepoRoot "extensions/$ext")
    try {
        Invoke-Native "npm ci ($ext)" { npm ci --ignore-scripts }
        Invoke-Native "npm run compile ($ext)" { npm run compile }
    }
    finally {
        Pop-Location
    }
}

# ============================================================
# COPY BUILT-IN EXTENSIONS
# ============================================================

Write-Step "Copying built-in extensions"
foreach ($ext in @("null-theme", "null-tools", "null-icons", "null-markdown", "null-cpp", "null-actions", "null-format")) {
    Copy-Item -Recurse -Force (Join-Path $RepoRoot "extensions/$ext") (Join-Path $VscodeSrc "extensions/")
}

# ============================================================
# BUNDLE CODE SPELL CHECKER
# ============================================================

Write-Step "Bundling Code Spell Checker"
$cspellTag = "code-spell-checker-v4.5.6"
$cspellVersion = $cspellTag -replace '^code-spell-checker-v', ''
$cspellDest = Join-Path $VscodeSrc "extensions/code-spell-checker"

if (Test-Path $cspellDest) {
    Write-Host "code-spell-checker already bundled, skipping"
}
else {
    Push-Location $WorkspaceDir
    try {
        $vsixZip = "cspell.zip"
        $vsixUrl = "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/streetsidesoftware/vsextensions/code-spell-checker/$cspellVersion/vspackage"
        Invoke-WebRequest $vsixUrl -OutFile $vsixZip -UseBasicParsing
        Expand-Archive $vsixZip -DestinationPath cspell-unpacked -Force
        Move-Item cspell-unpacked/extension $cspellDest

        node -e "
            const fs = require('fs');
            const file = '$($cspellDest -replace '\\','/')/package.json';
            const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
            delete pkg.workspaces;
            delete pkg.dependencies;
            delete pkg.devDependencies;
            delete pkg.scripts;
            delete pkg.private;
            fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
        "

        Remove-Item $vsixZip, cspell-unpacked -Recurse -Force -ErrorAction SilentlyContinue
    }
    finally {
        Pop-Location
    }
}

# ============================================================
# ICONS + WORKBENCH ASSETS
# ============================================================

Write-Step "Replacing icons"
$win32 = Join-Path $VscodeSrc "resources/win32"
foreach ($name in @("code", "codium", "vscodium", "null")) {
    Copy-Item (Join-Path $RepoRoot "icons/icon.ico") "$win32/$name.ico" -Force
}
Copy-Item (Join-Path $RepoRoot "icons/icon_150x150.png") "$win32/code_150x150.png" -Force
Copy-Item (Join-Path $RepoRoot "icons/icon_70x70.png")   "$win32/code_70x70.png"   -Force
Copy-Item (Join-Path $RepoRoot "icons/icon.svg") (Join-Path $VscodeSrc "src/vs/workbench/browser/media/code-icon.svg") -Force

Write-Step "Injecting workbench assets"
$wb = Join-Path $VscodeSrc "src/vs/code/electron-browser/workbench"
Copy-Item (Join-Path $RepoRoot "workbench/custom.css") "$wb/null-custom.css" -Force
Copy-Item (Join-Path $RepoRoot "workbench/splash.js")  "$wb/null-splash.js"  -Force

$workbenchHtml = Join-Path $wb "workbench.html"
$html = Get-Content $workbenchHtml -Raw
$anchor = '<link rel="stylesheet" href="../../../workbench/workbench.desktop.main.css">'
if (-not $html.Contains($anchor)) {
    throw "Anchor line not found in workbench.html - check the path after a VS Code version bump"
}
if (-not $html.Contains("null-splash.js")) {
    $inject = $anchor + "`n`t`t<link rel=`"stylesheet`" href=`"null-custom.css`">`n`t`t<script src=`"null-splash.js`"></script>"
    $html = $html.Replace($anchor, $inject)
    [System.IO.File]::WriteAllText($workbenchHtml, $html, [System.Text.UTF8Encoding]::new($false))
}

# ============================================================
# VS CODE DEPENDENCIES
# ============================================================

Write-Step "Installing vscode-src dependencies"
Push-Location $VscodeSrc
try {
    if ($Clean -or -not (Test-Path "node_modules") -or (Test-NodeModulesStale $VscodeSrc)) {
        Invoke-Native "npm ci (vscode-src)" { npm ci --prefer-offline --no-audit --fund=false }
    }
    else {
        Write-Host "node_modules already present and up to date, skipping npm ci"
        # npm ci's postinstall hook is what installs each extension's own
        # node_modules (extensions/*, .vscode/extensions/*, remote/web, ...).
        # On a reused clone, Get-OrCloneRepo's `git clean -fdx` just wiped all
        # of those (only the root node_modules is preserved) - so postinstall
        # has to be re-run explicitly here, or every extension stays
        # uninstalled and later compile/typecheck steps fail with missing
        # modules (e.g. "Cannot find type definition file for 'node'").
        # postinstall.ts's own isUpToDate() check reads a state file that
        # lives *inside* the preserved root node_modules, so it survives the
        # clean too and (since package.json/lockfile hashes didn't change)
        # reports "up to date" and skips reinstalling - even though the
        # extension node_modules it's supposed to guard are gone. Force it.
        # Must invoke the script directly (not via `npm run postinstall`):
        # `npm run` sets its own npm_command=run in the environment, which
        # postinstall.ts inherits into every per-extension install call
        # (npm_command || 'install'), turning each one into a no-op
        # `npm run` (lists scripts) instead of `npm install`.
        Invoke-Native "postinstall (vscode-src)" { $env:VSCODE_FORCE_INSTALL = '1'; Remove-Item Env:\npm_command -ErrorAction SilentlyContinue; node build/npm/postinstall.ts; Remove-Item Env:\VSCODE_FORCE_INSTALL }
    }

    if (-not (Test-Path "node_modules")) {
        throw "node_modules missing after dependency restore/install"
    }

    Write-Step "Installing @anthropic-ai/sdk pin"
    Invoke-Native "npm install @anthropic-ai/sdk" { npm install "@anthropic-ai/sdk@0.82.0" --no-save --no-audit --fund=false }
}
finally {
    Pop-Location
}

# gulp itself (esbuild, gulp-merge-json, jsonc-parser, workerpool, etc.) is a
# separate npm project rooted at vscode-src/build - installing only the repo
# root's node_modules leaves these unresolved and gulp fails with
# ERR_MODULE_NOT_FOUND partway through the build.
Write-Step "Installing vscode-src/build dependencies (gulp toolchain)"
Push-Location (Join-Path $VscodeSrc "build")
try {
    $buildDir = Join-Path $VscodeSrc "build"
    if ($Clean -or -not (Test-Path "node_modules") -or (Test-NodeModulesStale $buildDir)) {
        Invoke-Native "npm ci (vscode-src/build)" { npm ci --prefer-offline --no-audit --fund=false }
    }
    else {
        Write-Host "node_modules already present and up to date, skipping npm ci"
    }
}
finally {
    Pop-Location
}

# ============================================================
# REMOVE agentHost FILES THAT IMPORT @github/copilot-sdk
# ============================================================

Write-Step "Stripping @github/copilot-sdk references from agentHost"
Remove-Item -Recurse -Force (Join-Path $VscodeSrc "src/vs/platform/agentHost/test") -ErrorAction SilentlyContinue
$agentHost = Join-Path $VscodeSrc "src/vs/platform/agentHost"
$deletedBaseNames = @()
Get-ChildItem $agentHost -Recurse -Filter "*.ts" |
    Where-Object { (Get-Content $_.FullName -Raw) -match "'@github/copilot-sdk'" } |
    ForEach-Object {
        $deletedBaseNames += $_.BaseName
        Remove-Item $_.FullName -Force
    }
foreach ($baseName in $deletedBaseNames) {
    Get-ChildItem $agentHost -Recurse -Filter "*.ts" |
        ForEach-Object {
            $content = Get-Content $_.FullName -Raw
            $pattern = "(?m)^\s*import\s+'\./$([regex]::Escape($baseName))\.js';\s*\r?\n"
            if ($content -match $pattern) {
                $updated = $content -replace $pattern, ''
                [System.IO.File]::WriteAllText($_.FullName, $updated, [System.Text.UTF8Encoding]::new($false))
            }
        }
}
$agentHostServerMain = Join-Path $agentHost "node/agentHostServerMain.ts"
if (Test-Path $agentHostServerMain) {
    $c = [System.IO.File]::ReadAllText($agentHostServerMain)
    $c = $c -replace '(?s)\n\tif \(options\.enableMockAgent\) \{.+?\n\t\}', ''
    [System.IO.File]::WriteAllText($agentHostServerMain, $c, [System.Text.UTF8Encoding]::new($false))
}

# ============================================================
# BUILD
# ============================================================

Write-Step "Running gulp vscode-win32-x64 (this is the slow part)"
Push-Location $VscodeSrc
try {
    $env:NODE_OPTIONS = "--max-old-space-size=8192"
    $env:VSCODE_QUALITY = "stable"
    Invoke-Native "npx gulp vscode-win32-x64" { npx gulp vscode-win32-x64 }
}
finally {
    Remove-Item Env:\NODE_OPTIONS -ErrorAction SilentlyContinue
    Remove-Item Env:\VSCODE_QUALITY -ErrorAction SilentlyContinue
    Pop-Location
}

if (-not (Test-Path $OutDir)) {
    throw "Build output directory not found: $OutDir (expected gulp to write next to vscode-src)"
}

# ============================================================
# VERSION STAMPING
# ============================================================

Write-Step "Fetching VSCodium server commit hash"
Push-Location $WorkspaceDir
try {
    $serverUrl = "https://github.com/VSCodium/vscodium/releases/download/$tag/vscodium-reh-linux-x64-$tag.tar.gz"
    Invoke-WebRequest $serverUrl -OutFile "vscodium-reh.tar.gz" -UseBasicParsing
    New-Item -ItemType Directory -Path "server-extract" -Force | Out-Null
    tar -xzf "vscodium-reh.tar.gz" -C "server-extract" product.json
    $commit = (Get-Content "server-extract/product.json" -Raw | ConvertFrom-Json).commit
    Remove-Item "vscodium-reh.tar.gz" -Force
    Remove-Item "server-extract" -Recurse -Force
}
finally {
    Pop-Location
}

$buildVersion = if ($Version) { $Version } else { $tag }

Write-Step "Stamping version into output product.json"
$productPath = Join-Path $OutDir "resources/app/product.json"
$p = [System.IO.File]::ReadAllText($productPath) | ConvertFrom-Json
$p.version = $buildVersion
$p.commit = $commit
$p | Add-Member -MemberType NoteProperty -Name "release" -Value $buildVersion -Force
$p.serverDownloadUrlTemplate = "https://github.com/VSCodium/vscodium/releases/download/`${release}/vscodium-reh-`${os}-`${arch}-`${release}.tar.gz"
$p.webviewContentExternalBaseUrlTemplate = "https://{{uuid}}.vscode-cdn.net/stable/$commit/out/vs/workbench/contrib/webview/browser/pre/"
$p.win32x64UserAppId   = $p.win32x64UserAppId   -replace '^\{\{', '{'
$p.win32arm64AppId     = $p.win32arm64AppId     -replace '^\{\{', '{'
$p.win32arm64UserAppId = $p.win32arm64UserAppId -replace '^\{\{', '{'
[System.IO.File]::WriteAllText($productPath, ($p | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))

# ============================================================
# OUTPUT ASSET FIXUPS
# ============================================================

Write-Step "Fixing icons, VisualElementsManifest, letterpress SVGs in output"
$outWin32 = Join-Path $OutDir "resources/app/resources/win32"
foreach ($name in @("null", "code", "codium", "vscodium")) {
    Copy-Item (Join-Path $RepoRoot "icons/icon.ico") "$outWin32/$name.ico" -Force
}
Copy-Item (Join-Path $RepoRoot "icons/icon_150x150.png") "$outWin32/code_150x150.png" -Force
Copy-Item (Join-Path $RepoRoot "icons/icon_70x70.png")   "$outWin32/code_70x70.png"   -Force
Copy-Item (Join-Path $RepoRoot "installer/Null.VisualElementsManifest.xml") (Join-Path $OutDir "Null.VisualElementsManifest.xml") -Force

$outMedia = Join-Path $OutDir "resources/app/out/media"
foreach ($variant in @("letterpress-dark", "letterpress-hcDark")) {
    Copy-Item (Join-Path $RepoRoot "workbench/letterpress-dark.svg") "$outMedia/$variant.svg" -Force
}
foreach ($variant in @("letterpress-light", "letterpress-hcLight")) {
    Copy-Item (Join-Path $RepoRoot "workbench/letterpress-light.svg") "$outMedia/$variant.svg" -Force
}

Write-Step "Copying file-association icons"
$fileAssocDest = Join-Path $OutDir "resources/file-assoc-icons"
New-Item -ItemType Directory -Path $fileAssocDest -Force | Out-Null
Copy-Item (Join-Path $RepoRoot "icons/file-assoc/*.ico") $fileAssocDest -Force

Write-Step "Copying workbench overlay files into output"
$outWb = Join-Path $OutDir "resources/app/out/vs/code/electron-browser/workbench"
if (-not (Test-Path $outWb)) {
    throw "Build output workbench directory not found: $outWb"
}
Copy-Item (Join-Path $RepoRoot "workbench/custom.css") "$outWb/null-custom.css" -Force
Copy-Item (Join-Path $RepoRoot "workbench/splash.js")  "$outWb/null-splash.js"  -Force

Write-Step "Bundling node-pty into null-tools output"
$ptySrc = Join-Path $VscodeSrc "node_modules/node-pty"
$ptyDest = Join-Path $OutDir "resources/app/extensions/null-tools/node_modules/node-pty"
if (-not (Test-Path $ptySrc)) {
    throw "node-pty not found in vscode-src/node_modules - check npm ci output"
}
New-Item -ItemType Directory -Force (Split-Path $ptyDest) | Out-Null
Copy-Item $ptySrc $ptyDest -Recurse -Force

# ============================================================
# STAMP ICON INTO EXECUTABLE
# ============================================================

Write-Step "Stamping icon into executable"
$exe = Get-ChildItem $OutDir -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
    Invoke-Native "npm install rcedit" { npm install rcedit --prefix (Join-Path $WorkspaceDir "rcedit-tool") --silent }
    $rcedit = Join-Path $WorkspaceDir "rcedit-tool/node_modules/rcedit/bin/rcedit.exe"
    Invoke-Native "rcedit --set-icon" { & $rcedit $exe.FullName --set-icon (Join-Path $RepoRoot "icons/icon.ico") }

    $nullExe = Join-Path $OutDir "null.exe"
    if ($exe.Name -ne "null.exe") {
        if (Test-Path $nullExe) { Remove-Item $nullExe -Force }
        Rename-Item $exe.FullName $nullExe
    }
}
else {
    Write-Warning "No .exe found in $OutDir - skipping icon stamp"
}

# ============================================================
# WIN11 SHELL EXTENSION
# ============================================================

if (-not $SkipShellExt) {
    Write-Step "Building Win11 shell extension"

    $shellSrc  = Join-Path $RepoRoot "shell-ext"
    $dllDest   = Join-Path $OutDir "shell-ext/NullIDE.ExplorerCommand/x64"
    $assetDest = Join-Path $OutDir "shell-ext/Assets"
    $pkgDir    = Join-Path $OutDir "shell-ext"

    if (-not (Test-Path (Join-Path $shellSrc "deps/wil"))) {
        Invoke-WebRequest "https://github.com/microsoft/wil/archive/refs/heads/master.zip" -OutFile (Join-Path $WorkspaceDir "wil.zip")
        Expand-Archive (Join-Path $WorkspaceDir "wil.zip") (Join-Path $shellSrc "deps") -Force
        Rename-Item (Join-Path $shellSrc "deps/wil-master") "wil"
        Remove-Item (Join-Path $WorkspaceDir "wil.zip")
    }

    New-Item -ItemType Directory -Path $dllDest -Force | Out-Null
    $shellExtBuild = Join-Path $WorkspaceDir "shell-ext-build"
    Invoke-Native "cmake configure (shell-ext)" {
        cmake -S $shellSrc -B $shellExtBuild -G "Visual Studio 17 2022" -A x64 -DCMAKE_BUILD_TYPE=Release
    }
    Invoke-Native "cmake build (shell-ext)" { cmake --build $shellExtBuild --config Release }
    Copy-Item (Join-Path $shellExtBuild "Release/null_explorer_command.dll") $dllDest -Force
    # Never executed - see AppxManifest.xml for why this exists instead of null.exe.
    Copy-Item (Join-Path $shellExtBuild "Release/null_identity_stub.exe") $pkgDir -Force

    New-Item -ItemType Directory -Path $assetDest -Force | Out-Null
    Add-Type -AssemblyName System.Drawing
    function Resize-Png($src, $dst, $w, $h) {
        $img = [System.Drawing.Image]::FromFile((Resolve-Path $src))
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g   = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($img, 0, 0, $w, $h)
        $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose(); $img.Dispose()
    }
    $icon1024 = Join-Path $RepoRoot "icons/icon.png"
    Resize-Png $icon1024 "$assetDest/Square150x150Logo.png" 150 150
    Resize-Png $icon1024 "$assetDest/Square44x44Logo.png"   44  44
    Resize-Png $icon1024 "$assetDest/StoreLogo.png"         50  50

    Copy-Item (Join-Path $shellSrc "AppxManifest.xml") $pkgDir -Force

    # ponytail: reuse an existing "CN=Null IDE" cert across runs instead of
    # minting a new one every build - avoids piling up CurrentUser\My certs.
    $cert = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq "CN=Null IDE" -and $_.NotAfter -gt (Get-Date) } |
        Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate `
            -Subject "CN=Null IDE" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -Type CodeSigning `
            -KeySpec Signature `
            -KeyAlgorithm RSA `
            -KeyLength 2048 `
            -HashAlgorithm SHA256 `
            -NotAfter (Get-Date).AddYears(10)
    }
    $pfxPath = Join-Path $WorkspaceDir "NullIDECert.pfx"
    $pfxPwd = ConvertTo-SecureString -String "nullbuild" -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pfxPwd | Out-Null

    $makeappx = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter makeappx.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "x64" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $makeappx) { throw "makeappx.exe not found (needs Visual Studio 2022 with the Windows SDK)" }

    $appxStage = Join-Path $WorkspaceDir "appx-stage"
    if (Test-Path $appxStage) { Remove-Item $appxStage -Recurse -Force }
    New-Item -ItemType Directory -Path $appxStage -Force | Out-Null
    Copy-Item (Join-Path $pkgDir "AppxManifest.xml") $appxStage
    New-Item -ItemType Directory -Path "$appxStage/Assets" -Force | Out-Null
    Copy-Item "$assetDest/*" "$appxStage/Assets/"
    Invoke-Native "makeappx pack" { & $makeappx pack /d $appxStage /p (Join-Path $pkgDir "null-shell-ext.appx") /nv /o }
    Remove-Item $appxStage -Recurse -Force

    $signtool = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "x64" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $signtool) { throw "signtool.exe not found (needs Visual Studio 2022 with the Windows SDK)" }
    Invoke-Native "signtool sign" { & $signtool sign /fd SHA256 /f $pfxPath /p nullbuild (Join-Path $pkgDir "null-shell-ext.appx") }
    Remove-Item $pfxPath -Force

    Write-Host "Shell extension built and signed (thumbprint: $($cert.Thumbprint))"
}
else {
    Write-Host "Skipping shell extension (-SkipShellExt)"
}

# ============================================================
# UPDATER + INSTALLER PAYLOAD
# ============================================================

Write-Step "Building null-updater"
$updaterBuild = Join-Path $RepoRoot "updater/build"
Invoke-Native "cmake configure (updater)" {
    cmake -S (Join-Path $RepoRoot "updater") -B $updaterBuild -G "Visual Studio 17 2022" -A x64
}
Invoke-Native "cmake build (updater)" { cmake --build $updaterBuild --config Release }

Write-Step "Preparing installer and updater payload"
$updaterDir = Join-Path $OutDir "resources/app/null-updater"
New-Item -ItemType Directory -Path $updaterDir -Force | Out-Null
Copy-Item (Join-Path $RepoRoot "scripts/install-null-ide.ps1") $updaterDir -Force
Copy-Item (Join-Path $RepoRoot "scripts/update-null-ide.ps1")  $updaterDir -Force
Copy-Item (Join-Path $updaterBuild "Release/null-updater.exe") $updaterDir -Force

@{
    repo        = "TorresVisual/null-ide"
    version     = $buildVersion
    installedAt = $null
    installDir  = $null
} | ConvertTo-Json | Set-Content (Join-Path $OutDir ".null-ide-install.json") -Encoding UTF8

# ============================================================
# PACKAGE
# ============================================================

Write-Step "Creating zip archive"
$zipPath = Join-Path $WorkspaceDir "null-ide-win32-x64.zip"
Compress-Archive -Path "$OutDir\*" -DestinationPath $zipPath -Force
$hash = Get-FileHash $zipPath -Algorithm SHA256
"$($hash.Hash.ToLower())  null-ide-win32-x64.zip" | Set-Content "$zipPath.sha256" -Encoding ASCII -NoNewline
Write-Host "Archive: $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)"

if (-not $SkipInstaller) {
    Write-Step "Building Windows installer"
    Invoke-Native "ISCC.exe" {
        & $iscc (Join-Path $RepoRoot "installer/null-ide.iss") `
            /DSourceDir="$OutDir" /DAppVersion="$buildVersion" /O"$WorkspaceDir"
    }
    $installer = Get-ChildItem $WorkspaceDir -Filter "NullIDESetup*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) {
        throw "Inno Setup completed, but no NullIDESetup*.exe was found in $WorkspaceDir"
    }
    Write-Host "Installer: $($installer.FullName)"
}
else {
    Write-Host "Skipping installer (-SkipInstaller)"
}

# ============================================================
# PUBLISH RELEASE
# ============================================================

if ($PublishRelease) {
    Write-Step "Publishing GitHub release $buildVersion"

    $releaseFiles = @($zipPath, "$zipPath.sha256", $installer.FullName, (Join-Path $RepoRoot "scripts/install-null-ide.ps1"))

    $tagExists = (git tag --list $buildVersion)
    Write-Host ""
    Write-Host "About to publish:"
    Write-Host "  Repo:  TorresVisual/null-ide"
    Write-Host "  Tag:   $buildVersion $(if (-not $tagExists) { '(will be created and pushed)' } else { '(already exists)' })"
    Write-Host "  Files: $($releaseFiles -join ', ')"
    if (-not $tagExists) {
        Write-Warning "Pushing this tag will also trigger the GitHub Actions build workflow for it."
    }
    Write-Warning "This is a public GitHub Release. The in-app updater on real Null IDE installs checks it on startup."
    $confirm = Read-Host "Type 'yes' to publish"
    if ($confirm -ne "yes") {
        Write-Host "Skipping publish."
    }
    else {
        if (-not $tagExists) {
            Invoke-Native "git tag $buildVersion" { git tag $buildVersion }
            Invoke-Native "git push origin $buildVersion" { git push origin $buildVersion }
        }

        $releaseExists = $true
        try {
            Invoke-Native "gh release view $buildVersion" { gh release view $buildVersion --repo TorresVisual/null-ide }
        }
        catch {
            $releaseExists = $false
        }

        if ($releaseExists) {
            Invoke-Native "gh release upload" {
                gh release upload $buildVersion @releaseFiles --repo TorresVisual/null-ide --clobber
            }
        }
        else {
            Invoke-Native "gh release create" {
                gh release create $buildVersion @releaseFiles --repo TorresVisual/null-ide --title $buildVersion --notes "Published locally via scripts/build-local.ps1."
            }
        }

        Write-Host "Published: https://github.com/TorresVisual/null-ide/releases/tag/$buildVersion"
    }
}

Write-Step "Done"
Write-Host "Output: $OutDir"
Write-Host "Zip:    $zipPath"
