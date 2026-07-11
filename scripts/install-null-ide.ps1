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
    [switch]$NoFileAssoc,
    [switch]$NoPath,
    [switch]$RegisterContextMenu,
    [switch]$RegisterWin11ContextMenu,
    [switch]$RegisterFileAssociations,
    [switch]$UnregisterFileAssociations,
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

    # Enable key read by the Win11 shell-extension DLL (IsContextMenuEnabled / GetTitle)
    $installRoot = [System.IO.Path]::GetDirectoryName($ExePath)
    New-Item -Path 'HKCU:\Software\Classes\NullIDEContextMenu' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\Classes\NullIDEContextMenu' -Name 'Title' -Value 'Open with Null'
    Set-ItemProperty -Path 'HKCU:\Software\Classes\NullIDEContextMenu' -Name 'InstallDir' -Value $installRoot
}

function Unregister-ContextMenu {
    $keys = @(
        'HKCU:\Software\Classes\*\shell\NullIDE'
        'HKCU:\Software\Classes\Directory\shell\NullIDE'
        'HKCU:\Software\Classes\Directory\Background\shell\NullIDE'
        'HKCU:\Software\Classes\NullIDEContextMenu'
    )
    foreach ($key in $keys) {
        if (Test-Path $key) {
            Remove-Item -Path $key -Recurse -Force
        }
    }
}

function Add-ShellExtCertToStore {
    param(
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [ValidateSet('CurrentUser', 'LocalMachine')]
        [string]$StoreLocation
    )

    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('TrustedPeople', $StoreLocation)
    $store.Open('ReadWrite')
    try {
        $existing = $store.Certificates.Find(
            [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
            $Certificate.Thumbprint,
            $false)
        if ($existing.Count -eq 0) {
            $store.Add($Certificate)
        }
    }
    finally {
        $store.Close()
    }
}

function Install-ShellExtSigningCertificate {
    param([string]$CerPath)

    if (-not (Test-Path $CerPath)) {
        throw "Shell extension certificate not found: $CerPath"
    }

    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CerPath)
    Add-ShellExtCertToStore -Certificate $cert -StoreLocation 'CurrentUser'
}

function Install-ShellExtSigningCertificateElevated {
    param([string]$CerPath)

    $escapedCer = $CerPath.Replace("'", "''")
    $command = "Import-Certificate -FilePath '$escapedCer' -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null"
    $proc = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command) `
        -Verb RunAs -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "Could not install the shell extension certificate (exit $($proc.ExitCode)). Approve the UAC prompt or run as administrator."
    }
}

function Test-AppxUntrustedRootError {
    param($ErrorRecord)
    $msg = "$($ErrorRecord.Exception.Message)"
    return $msg -match '0x800B0109|800B0109|CERT_E_UNTRUSTEDROOT|not trusted'
}

function Restart-FileExplorer {
    try {
        Stop-Process -Name explorer -Force -ErrorAction Stop
    }
    catch {
        # Explorer restarts automatically when killed.
    }
}

function Ensure-NullIDEContextMenuRegistry {
    param([string]$InstallDir)

    $ctxKey = 'HKCU:\Software\Classes\NullIDEContextMenu'
    New-Item -Path $ctxKey -Force | Out-Null
    Set-ItemProperty -Path $ctxKey -Name 'Title' -Value 'Open with Null'
    if ($InstallDir) {
        Set-ItemProperty -Path $ctxKey -Name 'InstallDir' -Value ([System.IO.Path]::GetFullPath($InstallDir))
    }
}

function Register-Win11ContextMenu {
    param([string]$InstallDir)

    $installDir = [System.IO.Path]::GetFullPath($InstallDir)
    $appxPath = Join-Path $installDir 'shell-ext\null-shell-ext.appx'
    if (-not (Test-Path $appxPath)) {
        Write-Warning "Shell extension package not found at '$appxPath' - Win11 primary context menu skipped."
        return
    }

    $cerPath = Join-Path $installDir 'shell-ext\NullIDECert.cer'
    Ensure-NullIDEContextMenuRegistry -InstallDir $installDir

    try {
        Install-ShellExtSigningCertificate -CerPath $cerPath
    }
    catch {
        Write-Warning "Could not install signing certificate to CurrentUser\TrustedPeople: $_"
    }

    $existing = Get-AppxPackage -Name 'NullIDE.ExplorerCommand' -ErrorAction SilentlyContinue
    if ($existing) {
        Remove-AppxPackage -Package $existing.PackageFullName -ErrorAction SilentlyContinue
    }

    $registered = $false
    try {
        Add-AppxPackage -Path $appxPath -ExternalLocation $installDir -ForceUpdateFromAnyVersion -ErrorAction Stop
        $registered = $true
    }
    catch {
        if (-not (Test-AppxUntrustedRootError $_)) {
            throw "Win11 context menu registration failed: $($_.Exception.Message)"
        }
    }

    if (-not $registered) {
        Write-Host 'Windows requires a one-time UAC approval to trust the Null IDE shell extension certificate.'
        Install-ShellExtSigningCertificateElevated -CerPath $cerPath
        Add-AppxPackage -Path $appxPath -ExternalLocation $installDir -ForceUpdateFromAnyVersion -ErrorAction Stop
    }

    $pkg = Get-AppxPackage -Name 'NullIDE.ExplorerCommand' -ErrorAction SilentlyContinue
    if (-not $pkg) {
        throw 'Win11 context menu registration failed: NullIDE.ExplorerCommand package is not registered.'
    }

    # Keep registry InstallDir in sync with the ExternalLocation used for this package.
    Ensure-NullIDEContextMenuRegistry -InstallDir $installDir

    $mainExe = Get-ChildItem -Path $installDir -Filter "*.exe" -File |
        Where-Object { $_.Name -match '^(null|Null)\.exe$' } |
        Select-Object -First 1
    if (-not $mainExe) {
        Write-Warning "null.exe not found under '$installDir' - context menu may not launch Null IDE."
    }

    Restart-FileExplorer
    Write-Host 'Win11 context menu registered.'
}

function Unregister-Win11ContextMenu {
    $pkg = Get-AppxPackage -Name "NullIDE.ExplorerCommand" -ErrorAction SilentlyContinue
    if ($pkg) {
        Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction SilentlyContinue
    }
}

$FileAssocMap = [ordered]@{
    js       = @{ Description = 'JavaScript File';  Extensions = @('.js', '.jsx') }
    ts       = @{ Description = 'TypeScript File';  Extensions = @('.ts', '.tsx') }
    python   = @{ Description = 'Python File';       Extensions = @('.py') }
    json     = @{ Description = 'JSON File';         Extensions = @('.json') }
    markdown = @{ Description = 'Markdown File';     Extensions = @('.md') }
    html     = @{ Description = 'HTML File';         Extensions = @('.html', '.htm') }
    css      = @{ Description = 'CSS File';          Extensions = @('.css') }
    yaml     = @{ Description = 'YAML File';         Extensions = @('.yml', '.yaml') }
    text     = @{ Description = 'Text File';         Extensions = @('.txt') }
    xml      = @{ Description = 'XML File';          Extensions = @('.xml') }
    c        = @{ Description = 'C Source File';     Extensions = @('.c') }
    h        = @{ Description = 'C/C++ Header File'; Extensions = @('.h', '.hpp', '.inl') }
    cplus    = @{ Description = 'C++ Source File';   Extensions = @('.cpp', '.cc', '.cxx', '.c++') }
    csharp   = @{ Description = 'C# Source File';    Extensions = @('.cs') }
    go       = @{ Description = 'Go Source File';    Extensions = @('.go') }
    rust     = @{ Description = 'Rust Source File';  Extensions = @('.rs') }
    php      = @{ Description = 'PHP File';          Extensions = @('.php') }
    ruby     = @{ Description = 'Ruby File';         Extensions = @('.rb') }
    shell    = @{ Description = 'Shell Script';      Extensions = @('.sh', '.bash', '.ps1') }
    database = @{ Description = 'SQL File';          Extensions = @('.sql') }
    git      = @{ Description = 'Git File';               Extensions = @('.gitignore', '.gitattributes', '.gitconfig', '.gitmodules') }
    patch    = @{ Description = 'Patch File';              Extensions = @('.patch') }
    cmake    = @{ Description = 'CMake File';              Extensions = @('.cmake') }
    dart     = @{ Description = 'Dart File';               Extensions = @('.dart') }
    docker   = @{ Description = 'Dockerfile';              Extensions = @('.dockerfile') }
    notebook = @{ Description = 'Jupyter Notebook';        Extensions = @('.ipynb') }
    csproj   = @{ Description = 'C# Project File';         Extensions = @('.csproj') }
    hplus    = @{ Description = 'C/C++ Header File';       Extensions = @('.h++') }
    java     = @{ Description = 'Java File';               Extensions = @('.java', '.jar') }
    lua      = @{ Description = 'Lua File';                Extensions = @('.lua') }
    tex      = @{ Description = 'LaTeX File';              Extensions = @('.latex') }
    config   = @{ Description = 'Configuration File';      Extensions = @('.cfg', '.ini', '.config'); Icon = 'document' }
    workspace = @{ Description = 'VS Code Workspace';      Extensions = @('.code-workspace'); Icon = 'document' }
    iss      = @{ Description = 'Inno Setup Script';       Extensions = @('.iss'); Icon = 'document' }
    log      = @{ Description = 'Log File';                Extensions = @('.log'); Icon = 'document' }
}

function Send-ShellChangeNotification {
    Add-Type -Namespace NullIDE -Name Shell32 -MemberDefinition @'
[DllImport("shell32.dll")]
public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@ -ErrorAction SilentlyContinue
    # SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
    [NullIDE.Shell32]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}

function Register-FileAssociations {
    param([string]$InstallDir)

    $installDir = [System.IO.Path]::GetFullPath($InstallDir)
    $exePath    = Join-Path $installDir 'null.exe'
    $iconDir    = Join-Path $installDir 'resources\file-assoc-icons'

    foreach ($key in $FileAssocMap.Keys) {
        $info     = $FileAssocMap[$key]
        $progId   = "NullIDE.AssocFile.$key"
        $iconKey  = if ($info.Icon) { $info.Icon } else { $key }
        $iconPath = Join-Path $iconDir "$iconKey.ico"
        $progKey  = "HKCU:\Software\Classes\$progId"

        New-Item -Path $progKey -Force | Out-Null
        Set-ItemProperty -Path $progKey -Name '(default)' -Value $info.Description
        Set-ItemProperty -Path $progKey -Name 'FriendlyTypeName' -Value $info.Description

        New-Item -Path "$progKey\DefaultIcon" -Force | Out-Null
        Set-ItemProperty -Path "$progKey\DefaultIcon" -Name '(default)' -Value "$iconPath,0"

        New-Item -Path "$progKey\shell\open\command" -Force | Out-Null
        Set-ItemProperty -Path "$progKey\shell\open\command" -Name '(default)' -Value "`"$exePath`" `"%1`""

        foreach ($ext in $info.Extensions) {
            $openWithKey = "HKCU:\Software\Classes\$ext\OpenWithProgids"
            New-Item -Path $openWithKey -Force | Out-Null
            Set-ItemProperty -Path $openWithKey -Name $progId -Value ''
        }
    }

    $allExtensions = $FileAssocMap.Values | ForEach-Object { $_.Extensions } | Select-Object -Unique

    $appKey = 'HKCU:\Software\Classes\Applications\null.exe'
    New-Item -Path $appKey -Force | Out-Null
    Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'Null IDE'
    Set-ItemProperty -Path $appKey -Name 'SupportedTypes' -Value $allExtensions -Type MultiString
    New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value "`"$exePath`" `"%1`""

    $capKey = 'HKCU:\Software\Classes\NullIDE\Capabilities'
    New-Item -Path $capKey -Force | Out-Null
    Set-ItemProperty -Path $capKey -Name 'ApplicationName' -Value 'Null IDE'
    Set-ItemProperty -Path $capKey -Name 'ApplicationDescription' -Value 'A custom Windows code editor built on VSCodium.'

    New-Item -Path "$capKey\FileAssociations" -Force | Out-Null
    foreach ($key in $FileAssocMap.Keys) {
        $progId = "NullIDE.AssocFile.$key"
        foreach ($ext in $FileAssocMap[$key].Extensions) {
            Set-ItemProperty -Path "$capKey\FileAssociations" -Name $ext -Value $progId
        }
    }

    New-Item -Path 'HKCU:\Software\RegisteredApplications' -Force | Out-Null
    Set-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'Null IDE' -Value 'Software\Classes\NullIDE\Capabilities'

    Send-ShellChangeNotification
    Write-Host "Registered file associations for $($allExtensions.Count) extensions."
}

function Unregister-FileAssociations {
    foreach ($key in $FileAssocMap.Keys) {
        $progId    = "NullIDE.AssocFile.$key"
        $progIdKey = "HKCU:\Software\Classes\$progId"
        if (Test-Path $progIdKey) {
            Remove-Item -Path $progIdKey -Recurse -Force
        }
        foreach ($ext in $FileAssocMap[$key].Extensions) {
            $openWithKey = "HKCU:\Software\Classes\$ext\OpenWithProgids"
            if (Test-Path $openWithKey) {
                Remove-ItemProperty -Path $openWithKey -Name $progId -ErrorAction SilentlyContinue
            }
        }
    }

    $appKey = 'HKCU:\Software\Classes\Applications\null.exe'
    if (Test-Path $appKey) {
        Remove-Item -Path $appKey -Recurse -Force
    }

    $nullIdeKey = 'HKCU:\Software\Classes\NullIDE'
    if (Test-Path $nullIdeKey) {
        Remove-Item -Path $nullIdeKey -Recurse -Force
    }

    if (Test-Path 'HKCU:\Software\RegisteredApplications') {
        Remove-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'Null IDE' -ErrorAction SilentlyContinue
    }

    Send-ShellChangeNotification
    Write-Host 'Unregistered file associations.'
}

function Register-Path {
    param([string]$Dir)
    $current = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if (-not $current) { $current = '' }
    $parts = $current -split ';' | Where-Object { $_ -ne '' }
    if ($parts -notcontains $Dir) {
        $new = ($parts + $Dir) -join ';'
        [System.Environment]::SetEnvironmentVariable('PATH', $new, 'User')
        Write-Host "Added to PATH: $Dir"
        Write-Host "Open a new terminal to use 'null' from the command line."
    }
}

function Unregister-Path {
    param([string]$Dir)
    $current = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if (-not $current) { return }
    $parts = $current -split ';' | Where-Object { $_ -ne '' -and ($_ -ne $Dir) }
    [System.Environment]::SetEnvironmentVariable('PATH', ($parts -join ';'), 'User')
}

function Write-NullShim {
    param([string]$InstallDir)
    $binDir = Join-Path $InstallDir 'bin'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $shimPath = Join-Path $binDir 'null.cmd'
    # Use 'start' so null.exe is detached from the calling terminal session.
    # Without this, closing the terminal window kills the editor process.
    [System.IO.File]::WriteAllText(
        $shimPath,
        "@echo off`r`nstart `"`" `"%~dp0..\null.exe`" %*`r`n",
        [System.Text.Encoding]::ASCII
    )
    return $binDir
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

    $destinationFullPath = [System.IO.Path]::GetFullPath($Destination)
    $parentDir           = Split-Path $destinationFullPath -Parent
    $installName         = Split-Path $destinationFullPath -Leaf
    $guid                = [guid]::NewGuid().ToString("N").Substring(0, 8)
    $extractDir          = Join-Path ([System.IO.Path]::GetTempPath()) "null-ide-extract-$guid"
    $stageDir            = Join-Path $parentDir "null-ide-stage-$guid"
    $bakDir              = Join-Path $parentDir "null-ide-bak-$guid"

    $isUpdate   = Test-Path $destinationFullPath
    $ideRunning = Test-NullIdeRunning -Destination $destinationFullPath

    if ($ideRunning -and -not $isUpdate) {
        throw "Null IDE is running. Close null.exe before installing."
    }
    if ($ideRunning) {
        Write-Warning "Null IDE is running. Files will be swapped underneath it - restart the IDE after this completes."
    }

    if ($isUpdate -and -not $Force) {
        throw "Install directory already exists: $destinationFullPath. Pass -Force to update it."
    }

    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null

    try {
        Write-Step "Extracting package"
        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        Expand-Archive -Path $SourceZip -DestinationPath $extractDir -Force

        $exe = Get-ChildItem -Path $extractDir -Filter "null.exe" -Recurse -File |
            Sort-Object { $_.FullName.Length } | Select-Object -First 1
        if (-not $exe) { throw "The package does not contain null.exe." }
        $packageRoot = $exe.Directory.FullName

        # Stage new files on the same volume as the install dir so Rename-Item is atomic
        Write-Step "Staging new version"
        New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
        Get-ChildItem -LiteralPath $packageRoot -Force |
            ForEach-Object { Move-Item -LiteralPath $_.FullName -Destination $stageDir -Force }
        Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
        $extractDir = $null

        if ($isUpdate) {
            # Carry the portable data dir into the new install
            $dataSource = Join-Path $destinationFullPath "data"
            if (Test-Path $dataSource) {
                Write-Step "Preserving data directory"
                Move-Item -LiteralPath $dataSource -Destination (Join-Path $stageDir "data")
            }

            # Rename-swap: directory rename works even when files inside are open/locked
            Write-Step "Swapping installation ($(Split-Path $bakDir -Leaf))"
            Rename-Item -LiteralPath $destinationFullPath -NewName (Split-Path $bakDir -Leaf)
        }

        # Promote staged dir to the real install path
        Rename-Item -LiteralPath $stageDir -NewName $installName
        $stageDir = $null

        $binDir = Write-NullShim -InstallDir $destinationFullPath

        [ordered]@{
            repo        = $Repository
            version     = $InstalledVersion
            installedAt = (Get-Date).ToUniversalTime().ToString("o")
            installDir  = $destinationFullPath
        } | ConvertTo-Json | Set-Content -Path (Join-Path $destinationFullPath ".null-ide-install.json") -Encoding UTF8

        # Delete old backup - may fail if IDE is still holding handles; that is non-fatal
        if (Test-Path $bakDir) {
            try   { Remove-Item -LiteralPath $bakDir -Recurse -Force -ErrorAction Stop }
            catch { Write-Warning "Old files left at '$bakDir' (IDE still running?) - delete manually after closing Null IDE." }
        }

        $target = Get-NullIdeExecutable -Dir $destinationFullPath

        if (-not $NoDesktopShortcut) {
            Write-Step "Creating desktop shortcut"
            New-Shortcut -ShortcutPath (Join-Path ([Environment]::GetFolderPath("Desktop")) "Null IDE.lnk") `
                         -TargetPath $target -WorkingDirectory $destinationFullPath
        }

        if (-not $NoStartMenuShortcut) {
            Write-Step "Creating Start Menu shortcut"
            New-Shortcut -ShortcutPath (Join-Path ([Environment]::GetFolderPath("Programs")) "Null IDE\Null IDE.lnk") `
                         -TargetPath $target -WorkingDirectory $destinationFullPath
        }

        if (-not $NoContextMenu) {
            Write-Step "Registering context menu entries"
            Register-ContextMenu -ExePath $target
            Register-Win11ContextMenu -InstallDir $destinationFullPath
        }

        if (-not $NoFileAssoc) {
            Write-Step "Registering file associations"
            Register-FileAssociations -InstallDir $destinationFullPath
        }

        if (-not $NoPath) {
            Write-Step "Adding to user PATH"
            Unregister-Path -Dir $destinationFullPath  # remove old direct-exe entry from prior installs
            Register-Path -Dir $binDir
        }

        Write-Step "Seeding default settings"
        Set-DefaultSettings

        if ($Launch) {
            Write-Step "Launching Null IDE"
            Start-Process -FilePath $target -WorkingDirectory $destinationFullPath
        }

        Write-Host ""
        Write-Host "Null IDE $(if ($isUpdate) { 'updated' } else { 'installed' }): $destinationFullPath"
        Write-Host "Version: $InstalledVersion"
    }
    catch {
        # Rollback: rename backup back to install dir name
        if (Test-Path $bakDir) {
            Write-Warning "Install failed - restoring previous installation."
            if (Test-Path $destinationFullPath) {
                Remove-Item -LiteralPath $destinationFullPath -Recurse -Force -ErrorAction SilentlyContinue
            }
            try   { Rename-Item -LiteralPath $bakDir -NewName $installName }
            catch { Write-Warning "Rollback also failed - backup preserved at: $bakDir" }
        }
        if ($stageDir   -and (Test-Path $stageDir))   { Remove-Item -LiteralPath $stageDir   -Recurse -Force -ErrorAction SilentlyContinue }
        if ($extractDir -and (Test-Path $extractDir)) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
        throw
    }
}

function Get-NullIdeExecutable {
    param([string]$Dir)
    $mainExe = Get-ChildItem -Path $Dir -Filter "*.exe" -File |
        Where-Object { $_.Name -notmatch '^(unins|setup)' } |
        Select-Object -First 1
    if (-not $mainExe) {
        throw "Null IDE executable not found in $Dir"
    }
    return $mainExe.FullName
}

if ($RegisterContextMenu) {
    $dir = [System.IO.Path]::GetFullPath($InstallDir)
    $target = Get-NullIdeExecutable -Dir $dir
    Write-Step "Registering context menu entries"
    Register-ContextMenu -ExePath $target
    Write-Host "Done."
    return
}

if ($RegisterWin11ContextMenu) {
    $dir = [System.IO.Path]::GetFullPath($InstallDir)
    $null = Get-NullIdeExecutable -Dir $dir
    Write-Step "Registering Win11 context menu"
    Register-Win11ContextMenu -InstallDir $dir
    Write-Host "Done."
    return
}

if ($RegisterFileAssociations) {
    $dir = [System.IO.Path]::GetFullPath($InstallDir)
    Write-Step "Registering file associations"
    Register-FileAssociations -InstallDir $dir
    Write-Host "Done."
    return
}

if ($UnregisterFileAssociations) {
    Write-Step "Unregistering file associations"
    Unregister-FileAssociations
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
