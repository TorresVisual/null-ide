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
Name: "contextmenu"; Description: "Add ""Open in Null"" context menu entries"; GroupDescription: "Shell integration:"; Flags: checked
Name: "addtopath"; Description: "Add to user PATH (enables ""null ."" in new terminals)"; GroupDescription: "Shell integration:"; Flags: checked

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

[Run]
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
  OldPath: string;
  Parts: TArrayOfString;
  i: Integer;
  NewPath: string;
  First: Boolean;
begin
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', OldPath) then
    Exit;
  Parts := SplitString(OldPath, ';');
  NewPath := '';
  First := True;
  for i := 0 to GetArrayLength(Parts) - 1 do begin
    if not SameText(Parts[i], Dir) and (Parts[i] <> '') then begin
      if not First then
        NewPath := NewPath + ';';
      NewPath := NewPath + Parts[i];
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
begin
  if CurUninstallStep = usPostUninstall then
    RemoveFromUserPath(ExpandConstant('{app}'));
end;
