# null-setup registrations: real-machine parity runbook

Plan: `docs/plans/null-setup-registrations.md` (Task 10). The automated tests prove each rule in a scratch hive; this runbook proves that the real registry ends up the same as `install-null-ide.ps1`'s, and exercises what tests cannot (UAC, Explorer, APPX, shortcuts on the real Desktop).

**Status: not yet run.** Every Result below is open. The matrix re-points real shortcuts, the user PATH, file associations, the preview handler and the Win11 package, and restarts Explorer, so it is run by a person on purpose, not by an automated session.

## 1. Back up and build

```powershell
$bk = "$env:TEMP\null-reg-backup"; New-Item -ItemType Directory $bk -Force | Out-Null
foreach ($k in 'Software\Classes\NullIDE','Software\Classes\NullIDEContextMenu','Software\Classes\Applications\null.exe','Software\RegisteredApplications') { reg export "HKCU\$k" "$bk\$($k -replace '\\','_').reg" /y | Out-Null }
[Environment]::GetEnvironmentVariable('Path','User') | Set-Content "$bk\userpath.txt"
Copy-Item "$([Environment]::GetFolderPath('Programs'))\Null IDE" "$bk\StartMenu" -Recurse -ErrorAction SilentlyContinue
```

Build: `cargo build --release --locked -p null-setup` in `setup/`.

## 2. Dump function

It prints only what Null owns, one sorted line per value, so shared keys and other apps' entries never enter the comparison.

```powershell
function Dump-Key([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $k = Get-Item -LiteralPath $Path
  foreach ($n in $k.GetValueNames()) {
    '{0}|{1}|{2}|{3}' -f $k.Name, $n, $k.GetValueKind($n), (($k.GetValue($n, $null, 'DoNotExpandEnvironmentNames')) -join ',')
  }
  foreach ($s in $k.GetSubKeyNames()) { Dump-Key "$Path\$s" }
}
function Get-NullRegistrations {
  $c = 'HKCU:\Software\Classes'
  $own = 'NullIDEContextMenu','NullIDE','Applications\null.exe','*\shell\NullIDE','Directory\shell\NullIDE','Directory\Background\shell\NullIDE','CLSID\{58F3B583-5D67-489A-9069-97FD45B2569B}'
  $own + (Get-ChildItem $c -Name | Where-Object { $_ -like 'NullIDE.AssocFile.*' }) | ForEach-Object { Dump-Key "$c\$_" }
  foreach ($ext in (Get-ChildItem $c -Name | Where-Object { $_ -like '.*' })) {
    $o = "$c\$ext\OpenWithProgids"
    if (Test-Path -LiteralPath $o) { (Get-Item -LiteralPath $o).GetValueNames() | Where-Object { $_ -like 'NullIDE.*' } | ForEach-Object { "$ext|OpenWithProgids|$_" } }
    $s = "$c\$ext\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}"
    if ((Test-Path -LiteralPath $s) -and ((Get-Item -LiteralPath $s).GetValue('') -eq '{58F3B583-5D67-489A-9069-97FD45B2569B}')) { "$ext|shellex|ours" }
  }
  Dump-Key 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PreviewHandlers' | Where-Object { $_ -like '*58F3B583*' }
  'HKCU:\Software\RegisteredApplications|Null IDE|' + (Get-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name 'Null IDE' -ErrorAction SilentlyContinue).'Null IDE'
}
```

## 3. Capture both states

Use the install the daily IDE uses, or a copy of it, with identical `--install-dir` in both runs.

```powershell
$I = "$env:LOCALAPPDATA\Programs\Null IDE"; $S = "D:\Coding\Apps\null-ide"
$feat = 'contextMenu,fileAssociations,previewHandler'
# A: the script
& powershell -NoProfile -ExecutionPolicy Bypass -File "$S\scripts\install-null-ide.ps1" -InstallDir $I -Unregister $feat -NoElevate
& powershell -NoProfile -ExecutionPolicy Bypass -File "$S\scripts\install-null-ide.ps1" -InstallDir $I -Register $feat -NoElevate
Get-NullRegistrations | Sort-Object | Set-Content "$env:TEMP\reg-script.txt"
# B: Rust. `modify` with a config that has exactly those three on and the rest as they are
#    (copy <I>\install-config.json, set contextMenu/fileAssociations/previewHandler false, run modify, then true, run modify)
Get-NullRegistrations | Sort-Object | Set-Content "$env:TEMP\reg-rust.txt"
Compare-Object (Get-Content "$env:TEMP\reg-script.txt") (Get-Content "$env:TEMP\reg-rust.txt")
```

Expected: no output. Anything printed is a difference: fix the port, or write it down as accepted (for example a key order that does not matter) under "Accepted differences" below.

## 4. Matrix

Use a scratch install (`Null IDE ünï`, see `docs/specs/null-setup-installer-engine-test-runbook.md` for the scratch setup and `$env:APPDATA`), the release exe, and pipe output through `| Out-String`.

| # | Scenario | Expect | Result |
|---|---|---|---|
| 1 | The parity diff above | empty | not run |
| 2 | `install --version <tag> --install-dir "…\Null IDE ünï"` with defaults | Start Menu + Safe Mode shortcuts open the IDE (the Safe Mode one shows `[Safe Mode]`), `bin` on the PATH of a **new** terminal (`null --version` works), file associations and preview handler registered, no PowerShell window flashed | not run |
| 3 | Row 2 with the user PATH seeded to `%USERPROFILE%\bin;C:\Tools` as `REG_EXPAND_SZ` beforehand | afterwards `reg query HKCU\Environment /v Path` shows `REG_EXPAND_SZ`, `%USERPROFILE%\bin` untouched, our `bin` appended | not run |
| 4 | `modify` turning `desktopShortcut` on then off | the real Desktop shortcut appears, then disappears; nothing else changes | not run |
| 5 | Fresh install, Win11 context menu, certificate untrusted | one UAC prompt (title shows `null-setup.exe`), then right-click → "Open with Null" in the **top-level** Win11 menu works; `Get-AppxPackage NullIDE.ExplorerCommand` shows the install folder as `InstallLocation` | not run |
| 6 | Row 5 but **decline** UAC | `install` finishes with "installed, but some registrations failed: contextMenu: …certificate…"; no hang; the HKCU verbs (classic menu) still exist; file associations still registered | not run |
| 7 | `update` to a newer fake tag with a new certificate | no UAC; the existing package is kept (log says so); Explorer menu still works; needs-reapproval only when no package existed | not run |
| 8 | `modify` after row 7 | UAC once, package re-registered against the new certificate; a declined prompt must leave the old package in place | not run |
| 9 | `uninstall` of row 2's install, `null.exe` deleted first | shortcuts, PATH entries (both `bin` and the folder), associations, preview handler, verbs and the package are gone; `Get-NullRegistrations` prints nothing; `Null IDE` Start Menu folder gone | not run |
| 10 | Another app owns `.json`'s preview handler (set `HKCU\Software\Classes\.json\shellex\{8895b1c6-b41f-4c1c-a562-0d564250836f}` default to any other GUID), then row 2 and row 9 | our install leaves it, our uninstall leaves it | not run |
| 11 | Windows 10 22H2 VM: rows 2, 5, 9 | as above (the Win11 menu rows are N/A; the classic verbs must work) | open until a Win10 machine is available |

## 5. Restore

Restore the daily install from the backup (re-run `null-setup.exe modify --install-dir … --config …` for it, then re-import `$bk\*.reg` if anything differs from the backup).

## Accepted differences

None recorded yet. Deliberate differences from the script are listed in the plan's "Parity" section (failures collected instead of aborting; PATH compare ignores a trailing `\` and keeps the value type; `trust-cert` replaces `Import-Certificate -FilePath <anything>`), plus one found while porting: when `modify` replaces an existing Win11 package and the certificate is not yet machine-trusted, the elevated import now runs **before** the old package is removed, so a declined UAC prompt leaves the old package in place.

## Verdict

Open: **not yet PASS**. Rows 1–11 are to be run and recorded above.
