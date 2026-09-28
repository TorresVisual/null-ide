# Run once from the extension directory to build the native Wooting SDK
# bridge and compile the extension for local development in Null IDE.
#
# The bridge is a napi-rs (N-API) addon, so — like node-pty — the compiled
# .node binary is ABI-stable across Electron versions and never needs
# electron-rebuild. Requires the Rust toolchain (rustup) and a C++ linker
# (Visual Studio Build Tools with the "Desktop development with C++"
# workload) to be installed.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "Building native addon (native/)..."
Set-Location native
npm install
npm run build
Set-Location $PSScriptRoot

$binary = Join-Path $PSScriptRoot "native\index.win32-x64-msvc.node"
if (Test-Path $binary) {
    Write-Host "Native addon built: $binary"
} else {
    Write-Warning "Native addon not found at expected path -- check native/index.*.node"
}

Write-Host "Compiling TypeScript..."
npm install
npm run build

Write-Host ""
Write-Host "Done. Reload Null IDE (Ctrl+Shift+P -> Developer: Reload Window)."
