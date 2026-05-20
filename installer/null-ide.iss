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

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Null IDE"; Filename: "{app}\null.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Null IDE"; Filename: "{app}\null.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\null.exe"; Description: "{cm:LaunchProgram,Null IDE}"; Flags: nowait postinstall skipifsilent
