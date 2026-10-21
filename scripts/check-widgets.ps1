# Manual-check driver for the Null IDE desktop widgets (null_widgets.exe). Cannot run in CI.
#   -Status     what is running, registered and on disk right now, and which desktop window each widget window is a child of
#   -Checklist  prints the manual run (the list at the end of docs/specs/native-windows-widgets-design.md "Testing")
# Run in a PLAIN PowerShell window outside Null IDE (updating and quitting the IDE is part of the checklist).
param(
    [switch]$Status,
    [switch]$Checklist
)
$ErrorActionPreference = 'Stop'
function Section($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

if (-not ($Status -or $Checklist)) { $Status = $true }

if ($Status) {
    Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class NullWidgetsZ {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr p, EP cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  static string Cls(IntPtr h) { var c = new StringBuilder(64); GetClassName(h, c, 64); return c.ToString(); }
  // Every NullWidgetsWindow under the desktop windows (Progman, WorkerW) with its parent class. Widgets must be children of SHELLDLL_DefView.
  public static string Dump() {
    var sb = new StringBuilder();
    EnumWindows((top, l) => { var n = Cls(top);
      if (n == "Progman" || n == "WorkerW") EnumChildWindows(top, (h, l2) => { if (Cls(h) == "NullWidgetsWindow") sb.AppendLine("  " + Cls(h) + "  parent=" + Cls(GetParent(h)) + "  visible=" + IsWindowVisible(h)); return true; }, IntPtr.Zero);
      return true; }, IntPtr.Zero);
    return sb.ToString();
  }
}
'@

    Section 'Host'
    $build = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber
    "Windows build            : $build"
    $proc = Get-Process -Name 'null_widgets' -ErrorAction SilentlyContinue
    "null_widgets.exe running : $(if ($proc) { ($proc.Id -join ', ') } else { 'no' })"
    $ide = Get-Process -Name 'null' -ErrorAction SilentlyContinue
    "null.exe running         : $(if ($ide) { ($ide.Id -join ', ') } else { 'no' })"
    $run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).NullWidgets
    "Run entry NullWidgets    : $(if ($run) { $run } else { '<none>' })"

    Section 'Files'
    $dir = Join-Path $env:LOCALAPPDATA 'Null\widgets'
    foreach ($f in 'snapshot.json', 'layout.json', 'widgets-owner.json') {
        $p = Join-Path $dir $f
        if (Test-Path $p) { $i = Get-Item $p; "{0,-20}: {1} bytes, written {2}" -f $f, $i.Length, $i.LastWriteTime } else { "{0,-20}: <missing>" -f $f }
    }
    $snap = Join-Path $dir 'snapshot.json'
    if (Test-Path $snap) {
        $s = Get-Content $snap -Raw | ConvertFrom-Json
        "snapshot schema {0}: {1} projects, {2} issues, {3} PRs (issues {4}, PRs {5})" -f $s.schema, $s.projects.items.Count, $s.issues.items.Count, $s.prs.items.Count, $s.issues.status, $s.prs.status
    }

    Section 'Widget windows (expect three, each a child of SHELLDLL_DefView)'
    [NullWidgetsZ]::Dump()
}

if ($Checklist) {
@'

Desktop widgets manual run (cannot run in CI). Use a build from scripts/build-local.ps1, installed with NullIDESetup, on Windows 11 AND Windows 10.
 1. Wizard: "Desktop widgets" is offered and OFF. Install without it: -Status shows no Run entry and no null_widgets.exe.
 2. Null Setup -> Modify -> tick "Desktop widgets" -> Apply: the Run entry exists and three cards appear on the desktop reading "Open Null IDE to set up widgets".
 3. Null: Set Up Widgets in the IDE: pick an account and repos. snapshot.json appears; the cards fill in with correct data and "updated <age>".
 4. Click an issue / PR row: the browser opens that GitHub page. Click a project row: Null IDE opens the folder. Right-click a project row -> "Open in new window" opens a new window.
    Both IDE windows get a normal taskbar slot and icon (the widgets exe is not packaged, so no package identity is involved).
 5. Drag a card: it follows the cursor, snaps to screen edges, and keeps its place after Quit widgets + relaunch. Lock widgets: dragging does nothing. Unlock again.
 6. Win+D: the cards stay visible. Open and focus an app: it covers a card; the card never comes in front of any app. -Status: three NullWidgetsWindow entries whose parent is SHELLDLL_DefView.
 7. Hide this widget on all three, then run `<install>\null_widgets.exe` again (or Null: Set Up Widgets): all three come back.
 8. Sleep and resume; unplug / plug a monitor; change display scaling: cards stay visible and on screen, text stays sharp.
 9. Restart Explorer (Task Manager -> Windows Explorer -> Restart): Explorer destroys the cards; within about 5 seconds new ones appear on the new desktop.
10. Quit Null IDE completely: cards keep showing the last data; "updated" ages; after 6 h the footer is muted.
11. Turn null.widgets.enabled off in the IDE: snapshot.json disappears and the cards read "Open Null IDE to set up widgets". Turn it on again: data returns.
12. Sign the account out in null-accounts: rows stay, dimmed, footer "Signed out of GitHub".
13. Update with the widgets running (headless update from a copy outside the install, see setup/CLAUDE.md): no "files are locked" prompt; the cards are back afterwards.
14. Untick "Desktop widgets" in Modify: cards disappear, Run entry and %LOCALAPPDATA%\Null\widgets are gone, IDE untouched. Tick again, then Uninstall: same cleanup.
'@
}
