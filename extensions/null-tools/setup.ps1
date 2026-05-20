# Run once from the extension directory to install node-pty for Null IDE's Electron version.
# After it completes, restart Null IDE (or Developer: Reload Window).

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "Installing node-pty..."
npm install node-pty@1.2.0-beta.12 --no-save --no-package-lock

Write-Host "Rebuilding native addon for Electron 39.8.7..."
npx --yes @electron/rebuild -v 39.8.7 -w node-pty

Write-Host ""
Write-Host "Done. Copy extension to your test build, then reload Null IDE."
