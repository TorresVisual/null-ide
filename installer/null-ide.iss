#ifndef SourceDir
#define SourceDir "VSCode-win32-x64"
#endif

#ifndef AppVersion
#define AppVersion "0.0.0"
#endif

[Setup]
AppId={{f40e5a45-4bd1-428a-aa94-34d9eaf09dc5}
AppName=Null IDE
AppVersion={#AppVersion}
AppPublisher=Null
AppPublisherURL=https://github.com/TorresVisual/null-ide
AppSupportURL=https://github.com/TorresVisual/null-ide/issues
AppUpdatesURL=https://github.com/TorresVisual/null-ide/releases
DefaultDirName={localappdata}\Programs\Null IDE
DefaultGroupName=Null IDE
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..
OutputBaseFilename=NullIDESetup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\null.exe
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "contextmenu"; Description: "Add ""Open in Null"" context menu entries"; GroupDescription: "Shell integration:"
Name: "fileassoc"; Description: "Register Null IDE as an available app for common code file types"; GroupDescription: "Shell integration:"
Name: "previewhandler"; Description: "Show code file content in the Explorer Preview Pane (Alt+P)"; GroupDescription: "Shell integration:"
Name: "addtopath"; Description: "Add to user PATH (enables ""null ."" in new terminals)"; GroupDescription: "Shell integration:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Null IDE"; Filename: "{app}\null.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Null IDE"; Filename: "{app}\null.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
; Context menu: individual files
Root: HKCU; Subkey: "Software\Classes\*\shell\NullIDE"; ValueType: string; ValueName: ""; ValueData: "Open in Null"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\*\shell\NullIDE"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\null.exe,0"; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\*\shell\NullIDE\command"; ValueType: string; ValueName: ""; ValueData: """{app}\null.exe"" ""%1"""; Tasks: contextmenu
; Context menu: folders
Root: HKCU; Subkey: "Software\Classes\Directory\shell\NullIDE"; ValueType: string; ValueName: ""; ValueData: "Open Folder in Null"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\shell\NullIDE"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\null.exe,0"; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\shell\NullIDE\command"; ValueType: string; ValueName: ""; ValueData: """{app}\null.exe"" ""%1"""; Tasks: contextmenu
; Context menu: folder background (right-click inside a folder)
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\NullIDE"; ValueType: string; ValueName: ""; ValueData: "Open Folder in Null"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\NullIDE"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\null.exe,0"; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\NullIDE\command"; ValueType: string; ValueName: ""; ValueData: """{app}\null.exe"" ""%V"""; Tasks: contextmenu
; Enable key read by the Win11 shell-extension DLL (IsContextMenuEnabled / GetTitle)
Root: HKCU; Subkey: "Software\Classes\NullIDEContextMenu"; ValueType: string; ValueName: "Title"; ValueData: "Open with Null"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\NullIDEContextMenu"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Flags: uninsdeletekey; Tasks: contextmenu

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\resources\app\null-updater\install-null-ide.ps1"" -RegisterWin11ContextMenu -InstallDir ""{app}"""; Flags: runhidden; Tasks: contextmenu; Description: "Registering Win11 context menu"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\resources\app\null-updater\install-null-ide.ps1"" -RegisterFileAssociations -InstallDir ""{app}"""; Flags: runhidden; Tasks: fileassoc; Description: "Registering file associations"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\resources\app\null-updater\install-null-ide.ps1"" -RegisterPreviewHandler -InstallDir ""{app}"""; Flags: runhidden; Tasks: previewhandler; Description: "Registering preview handler"
Filename: "{app}\null.exe"; Description: "{cm:LaunchProgram,Null IDE}"; Flags: nowait postinstall skipifsilent

[Code]
procedure AddToUserPath(const Dir: string);
var
  OldPath, NewPath: string;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OldPath) then
    OldPath := '';
  if Pos(';' + Lowercase(Dir) + ';', ';' + Lowercase(OldPath) + ';') > 0 then
    Exit;
  if OldPath = '' then
    NewPath := Dir
  else if OldPath[Length(OldPath)] = ';' then
    NewPath := OldPath + Dir
  else
    NewPath := OldPath + ';' + Dir;
  RegWriteStringValue(HKCU, 'Environment', 'Path', NewPath);
end;

procedure RemoveFromUserPath(const Dir: string);
var
  OldPath, NewPath, Token: string;
  p: Integer;
  First: Boolean;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OldPath) then
    Exit;
  NewPath := '';
  First := True;
  OldPath := OldPath + ';';
  p := Pos(';', OldPath);
  while p > 0 do begin
    Token := Copy(OldPath, 1, p - 1);
    OldPath := Copy(OldPath, p + 1, Length(OldPath));
    p := Pos(';', OldPath);
    if (Token <> '') and not SameText(Token, Dir) then begin
      if not First then
        NewPath := NewPath + ';';
      NewPath := NewPath + Token;
      First := False;
    end;
  end;
  RegWriteStringValue(HKCU, 'Environment', 'Path', NewPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and IsTaskSelected('addtopath') then
    AddToUserPath(ExpandConstant('{app}'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usPostUninstall then begin
    RemoveFromUserPath(ExpandConstant('{app}'));
    Exec('powershell.exe',
         '-NoProfile -ExecutionPolicy Bypass -Command '
         + '"Get-AppxPackage -Name NullIDE.ExplorerCommand | Remove-AppxPackage"',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('powershell.exe',
         '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\resources\app\null-updater\install-null-ide.ps1') + '" -UnregisterFileAssociations',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('powershell.exe',
         '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\resources\app\null-updater\install-null-ide.ps1') + '" -UnregisterPreviewHandler',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
