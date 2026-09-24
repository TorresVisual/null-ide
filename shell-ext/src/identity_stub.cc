// Never executed. AppxManifest.xml's sparse package requires an
// <Application Executable="..."> entry, which declares the package's
// identity-bearing app. Pointing it at this stub rather than at the real
// 222 MB editor binary keeps Windows from treating null.exe as this
// package's Application (AppsFolder entry, "Open with" list, package AUMID).
//
// This is not what fixed issue #42 - see the note in AppxManifest.xml and
// LaunchViaExplorer() in explorer_command.cc for what actually did.
// See also shell-ext/CMakeLists.txt.
int main() {
  return 0;
}
