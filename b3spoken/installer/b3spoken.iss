; B3spoken installer (Inno Setup 6). Built by scripts/build-exe.mjs.
; Installs for the current user only (no admin rights), adds Start menu and optional desktop shortcuts,
; and starts B3spoken, which opens in the browser. Uninstalling leaves the person's own files
; (resume, answers, tracker, documents in %LOCALAPPDATA%\B3spoken) unless they delete them.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6E0B7C1E-4E0B-4B39-9B0E-B3B3B3A0C0DE}
AppName=B3spoken
AppVersion={#AppVersion}
AppPublisher=B3spoken (open source)
AppPublisherURL=https://github.com/Dapper-D/job-board
DefaultDirName={localappdata}\Programs\B3spoken
DefaultGroupName=B3spoken
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=B3spoken-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
UninstallDisplayName=B3spoken

[Tasks]
Name: "desktopicon"; Description: "Add a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\dist\B3spoken.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\B3spoken"; Filename: "{app}\B3spoken.exe"; Comment: "Open B3spoken"
Name: "{autodesktop}\B3spoken"; Filename: "{app}\B3spoken.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\B3spoken.exe"; Description: "Open B3spoken now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im B3spoken.exe"; Flags: runhidden; RunOnceId: "StopB3spoken"
