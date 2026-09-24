# Diagnostic for issue #42 - reports whether a context-menu-launched Null IDE
# window carries the shell extension's sparse package identity.
#
# Run this in a PLAIN PowerShell/Terminal window opened OUTSIDE Null IDE
# (e.g. Win+X -> Terminal), not in a terminal panel inside Null IDE itself -
# closing all Null IDE windows in the repro steps below would kill that.
#
# Steps:
#   1. Run this script. It will wait.
#   2. Close every Null IDE window (fully quit, no Null.exe processes left).
#   3. Right-click a folder -> "Open with Null".
#   4. Come back here - it prints the new window's identity.
#
# How to read the output. GetApplicationUserModelId reports the *package*
# AUMID, which only packaged processes have. It does NOT report the explicit
# AUMID that product.json's win32AppUserModelId ("NullIDE") sets - that one is
# only readable in-process, so it never shows up here.
#
#   PackageAUMID=<none>   GOOD. Same as a Start Menu / pinned taskbar launch:
#                         no package identity, so Electron's own explicit
#                         AUMID applies and the window docks into the pinned
#                         slot with the icon stamped into Null.exe.
#
#   PackageAUMID=NullIDE.ExplorerCommand_<hash>!NullIDE
#                         BAD - issue #42 has regressed. The process was
#                         created by the packaged dllhost surrogate, so
#                         Windows fused the package identity onto it. A
#                         packaged process cannot override its own AUMID, so
#                         it shows the package's logo and gets its own taskbar
#                         entry. Expect Parent=dllhost in this case; a healthy
#                         launch shows Parent=explorer (see LaunchViaExplorer
#                         in shell-ext/src/explorer_command.cc).

Add-Type -Namespace NullIde -Name Aumid -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
[DllImport("kernel32.dll")]
public static extern bool CloseHandle(IntPtr h);
// Exported by kernel32.dll, not shell32.dll.
[DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
public static extern int GetApplicationUserModelId(IntPtr hProcess, ref uint appIdLen, System.Text.StringBuilder appId);
'@

function Get-PackageAumid([int]$ProcessId) {
    $h = [NullIde.Aumid]::OpenProcess(0x1000, $false, $ProcessId)   # QUERY_LIMITED_INFORMATION
    if ($h -eq [IntPtr]::Zero) { return "<could not open process>" }
    $sb = New-Object System.Text.StringBuilder 260
    $len = [uint32]260
    $hr = [NullIde.Aumid]::GetApplicationUserModelId($h, [ref]$len, $sb)
    [NullIde.Aumid]::CloseHandle($h) | Out-Null
    if ($hr -eq 0) { return $sb.ToString() }
    return "<none>"   # 15700/15703 = process has no package identity
}

$before = @{}
Get-Process -Name Null -ErrorAction SilentlyContinue | ForEach-Object { $before[$_.Id] = $true }

Write-Host "Waiting for a new Null.exe window..."
Write-Host "Close all Null IDE windows now, then use the right-click menu."
Write-Host "(GOOD = PackageAUMID <none> and Parent=explorer)"
Write-Host ""

while ($true) {
    Start-Sleep -Milliseconds 500
    $new = Get-Process -Name Null -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and -not $before.ContainsKey($_.Id) }
    if ($new) {
        foreach ($p in $new) {
            $ppid = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)").ParentProcessId
            $pname = try { (Get-Process -Id $ppid -ErrorAction Stop).ProcessName } catch { '(exited)' }
            $aumid = Get-PackageAumid $p.Id
            $verdict = if ($aumid -eq '<none>') { 'GOOD' } else { 'BAD - issue #42 regressed' }
            Write-Host "PID $($p.Id)  Parent=$ppid($pname)  PackageAUMID=$aumid  => $verdict"
        }
        break
    }
}
