# Run once from the extension directory to install node-pty for Null IDE.
# node-pty uses N-API (ABI-stable), so the npm prebuilt works across Electron
# versions without recompilation. No Visual Studio or build tools required.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "Installing node-pty..."
npm install node-pty@1.2.0-beta.12 --no-save --no-package-lock

# Verify the prebuilt loads
$prebuilt = Join-Path $PSScriptRoot "node_modules\node-pty\prebuilds\win32-x64\conpty.node"
if (Test-Path $prebuilt) {
    Write-Host "Prebuilt found: $prebuilt"
} else {
    Write-Warning "Prebuilt not found at expected path -- check node_modules\node-pty\prebuilds\win32-x64\"
}

Write-Host ""
Write-Host "Done. Reload Null IDE (Ctrl+Shift+P -> Developer: Reload Window)."
