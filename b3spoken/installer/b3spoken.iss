; B3spoken PRIVATE build installer (Inno Setup 6). Built by scripts/build-exe.mjs.
; Its own AppId, folder and name, so it installs beside the public B3spoken instead of replacing it.
; Installs for the current user only (no admin rights), adds Start menu and optional desktop shortcuts,
; and starts B3spoken, which opens in the browser. Uninstalling leaves the person's own files
; (resume, answers, tracker, documents in %LOCALAPPDATA%\B3spoken-Private) unless they delete them.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{7F1C9D2A-3B4E-4C5D-9E6F-0A1B2C3D4E5F}
AppName=B3spoken (Private)
AppVersion={#AppVersion}
AppPublisher=B3spoken (open source)
AppPublisherURL=https://github.com/Dapper-D/job-board
DefaultDirName={localappdata}\Programs\B3spoken-Private
DefaultGroupName=B3spoken (Private)
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=B3spoken-Private-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
UninstallDisplayName=B3spoken (Private)

[Tasks]
Name: "desktopicon"; Description: "Add a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\dist\B3spoken.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\B3spoken (Private)"; Filename: "{app}\B3spoken.exe"; Comment: "Open B3spoken (Private)"
Name: "{autodesktop}\B3spoken (Private)"; Filename: "{app}\B3spoken.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\B3spoken.exe"; Description: "Open B3spoken (Private) now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{userstartup}\B3spoken (Private).lnk"

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im B3spoken.exe"; Flags: runhidden; RunOnceId: "StopB3spoken"
