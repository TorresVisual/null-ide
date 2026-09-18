$root = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }
$targets = @(
    "$env:LOCALAPPDATA\Programs\Null IDE\resources\app",
    "C:\Users\Moritz\AppData\Local\Programs\Null IDE\resources\app",
    "C:\Users\Torres\AppData\Local\Programs\Null IDE\resources\app"
) | Select-Object -Unique

# product.json fields stamped at build time or owned by upstream -- never overwrite these
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

foreach ($app in $targets) {
    if (-not (Test-Path $app)) { Write-Host "Skipping missing: $app"; continue }

    $installDir = Split-Path (Split-Path $app)
    Write-Host ""
    Write-Host "Syncing -> $installDir"

    # --- 1. Workbench CSS + splash JS ---
    $wb = "$app\out\vs\code\electron-browser\workbench"
    if (Test-Path $wb) {
        Copy-Item "$root\workbench\custom.css" "$wb\null-custom.css" -Force
        Copy-Item "$root\workbench\splash.js"  "$wb\null-splash.js"  -Force
        Write-Host "  [ok] workbench CSS + JS"
    } else {
        Write-Warning "  workbench dir not found: $wb"
    }

    # --- 2. Media: letterpress watermark + code-icon ---
    $media = "$app\out\media"
    if (Test-Path $media) {
        Copy-Item "$root\workbench\letterpress-dark.svg"  "$media\letterpress-dark.svg"    -Force
        Copy-Item "$root\workbench\letterpress-dark.svg"  "$media\letterpress-hcDark.svg"  -Force
        Copy-Item "$root\workbench\letterpress-light.svg" "$media\letterpress-light.svg"   -Force
        Copy-Item "$root\workbench\letterpress-light.svg" "$media\letterpress-hcLight.svg" -Force
        Copy-Item "$root\icons\icon.svg"                  "$media\code-icon.svg"           -Force
        Write-Host "  [ok] media SVGs (letterpress + code-icon)"
    }

    # --- 3. Built-in extensions ---
    # null-theme and null-icons: full replace (no native code)
    foreach ($ext in @("null-theme", "null-icons", "null-markdown")) {
        $dest = "$app\extensions\$ext"
        Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item "$root\extensions\$ext" $dest -Recurse -Force
    }

    # null-tools: compile TypeScript before syncing so out/ is up-to-date.
    Push-Location "$root\extensions\null-tools"
    npm run compile 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "  [warn] TypeScript compile failed -- out/ may be stale" }
    Pop-Location
    Write-Host "  [ok] null-tools compiled"

    # null-tools: preserve node_modules so compiled node-pty binaries survive.
    # Only seed node_modules from source if destination has none (first install).
    $toolsSrc  = "$root\extensions\null-tools"
    $toolsDest = "$app\extensions\null-tools"
    if (-not (Test-Path $toolsDest)) { New-Item -ItemType Directory -Path $toolsDest -Force | Out-Null }
    Get-ChildItem $toolsSrc -Recurse | Where-Object {
        $_.FullName -notmatch '\\node_modules(\\|$)' -and
        $_.FullName -notmatch '\\src(\\|$)' -and
        (-not $_.PSIsContainer)
    } | ForEach-Object {
        $rel    = $_.FullName.Substring($toolsSrc.Length + 1)
        $target = Join-Path $toolsDest $rel
        $dir    = Split-Path $target -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Copy-Item $_.FullName $target -Force
    }
    if (-not (Test-Path "$toolsDest\node_modules")) {
        Copy-Item "$toolsSrc\node_modules" "$toolsDest\node_modules" -Recurse -Force
    }
    Write-Host "  [ok] extensions (null-theme, null-icons, null-tools, null-markdown)"

    # --- 4. Win32 icons ---
    $win32 = "$app\resources\win32"
    if (Test-Path $win32) {
        foreach ($name in @("null", "code", "codium", "vscodium")) {
            Copy-Item "$root\icons\icon.ico" "$win32\$name.ico" -Force
        }
        Copy-Item "$root\icons\icon_150x150.png" "$win32\code_150x150.png" -Force
        Copy-Item "$root\icons\icon_70x70.png"   "$win32\code_70x70.png"   -Force
        Write-Host "  [ok] win32 icons"
    }

    # --- 5. VisualElementsManifest ---
    Copy-Item "$root\installer\Null.VisualElementsManifest.xml" "$installDir\Null.VisualElementsManifest.xml" -Force
    Write-Host "  [ok] VisualElementsManifest"

    # --- 6. product.json: merge overlay, preserve build-stamped fields ---
    $productPath = "$app\product.json"
    if (Test-Path $productPath) {
        $installed = [System.IO.File]::ReadAllText($productPath) | ConvertFrom-Json
        $overlay   = [System.IO.File]::ReadAllText("$root\product.json") | ConvertFrom-Json

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
        Write-Host "  [ok] product.json"
    }

    # --- 7. Updater scripts & native binary ---
    $updaterDir = "$app\null-updater"
    New-Item -ItemType Directory -Path $updaterDir -Force | Out-Null
    Copy-Item "$root\scripts\install-null-ide.ps1" $updaterDir -Force
    Copy-Item "$root\scripts\update-null-ide.ps1"  $updaterDir -Force
    $nativeExe = "$root\updater\build\Release\null-updater.exe"
    if (Test-Path $nativeExe) {
        Copy-Item $nativeExe $updaterDir -Force
        Write-Host "  [ok] updater (null-updater.exe + ps1 scripts)"
    } else {
        Write-Host "  [ok] updater scripts"
    }

    # --- 8. Exe icon (skip if IDE is running) ---
    # $rcedit = "$root\rcedit-tool\node_modules\rcedit\bin\rcedit.exe"
    # $exe    = Get-ChildItem $installDir -Filter "*.exe" -ErrorAction SilentlyContinue |
    #           Where-Object { $_.Name -notmatch 'unins' } | Select-Object -First 1
    # if ($exe -and (Test-Path $rcedit)) {
    #     if (Get-Process -Name $exe.BaseName -ErrorAction SilentlyContinue) {
    #         Write-Warning "  [skip] exe icon: close $($exe.Name) and re-run to stamp"
    #     } else {
    #         & $rcedit $exe.FullName --set-icon "$root\icons\icon.ico" | Out-Null
    #         Write-Host "  [ok] exe icon stamped ($($exe.Name))"
    #     }
    # } elseif (-not (Test-Path $rcedit)) {
    #     Write-Warning "  [skip] exe icon: run 'npm install rcedit --prefix $root\rcedit-tool' first"
    # }
}

Write-Host ""
Write-Host "Done."
