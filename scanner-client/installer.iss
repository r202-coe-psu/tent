; Inno Setup script for scanner-client. build.ps1 compiles it after PyInstaller:
;   ISCC.exe /DAppVersion=0.1.0 installer.iss   ->  dist\scanner-client-setup.exe
; Per-user install (no admin). Asks for SHELTER_URL and writes .env next to the .exe;
; an existing .env is kept on upgrade. Unsigned: Smart App Control must be off (README).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6E0B2E3C-6A1F-4C1B-9D6B-3C7A1E5B2F10}
AppName=tent scanner client
AppVersion={#AppVersion}
AppPublisher=tent
DefaultDirName={localappdata}\Programs\tent-scanner-client
DefaultGroupName=tent
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=scanner-client-setup
SetupIconFile=assets\tent.ico
UninstallDisplayIcon={app}\scanner-client.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "dist\scanner-client\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "install-shortcut.*"
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\tent"; Filename: "{app}\scanner-client.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\tent"; Filename: "{app}\scanner-client.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\scanner-client.exe"; Description: "เปิดโปรแกรมเลย"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; written by [Code], so the uninstaller does not know about it otherwise
Type: files; Name: "{app}\.env"

[Code]
var
  UrlPage: TInputQueryWizardPage;

function EnvPath(): String;
begin
  Result := ExpandConstant('{app}\.env');
end;

procedure InitializeWizard();
begin
  UrlPage := CreateInputQueryPage(wpSelectTasks,
    'ที่อยู่เว็บศูนย์พักพิง',
    'ใส่ SHELTER_URL ของศูนย์ฯ',
    'ใส่แค่ https://ชื่อเว็บ ไม่ต้องมี path เช่น https://shelter.example.org' + #13#10 +
    'เครื่อง edge ในวง LAN ใช้ http:// ได้เฉพาะ IP วงภายใน เช่น http://192.168.1.10');
  UrlPage.Add('SHELTER_URL:', False);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // Upgrade: keep the existing .env, do not ask again.
  Result := (PageID = UrlPage.ID) and FileExists(EnvPath());
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Url: String;
begin
  Result := True;
  if CurPageID = UrlPage.ID then
  begin
    Url := Trim(UrlPage.Values[0]);
    // Full validation happens in the app (config.py); this only catches obvious typos.
    if (Pos('https://', Lowercase(Url)) <> 1) and (Pos('http://', Lowercase(Url)) <> 1) then
    begin
      MsgBox('SHELTER_URL ต้องขึ้นต้นด้วย https:// หรือ http://', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  // A /SILENT install without a URL leaves no .env; the app then logs "SHELTER_URL is required".
  if (CurStep = ssPostInstall) and not FileExists(EnvPath()) and (Trim(UrlPage.Values[0]) <> '') then
    SaveStringToFile(EnvPath(), 'SHELTER_URL=' + Trim(UrlPage.Values[0]) + #13#10, False);
end;
