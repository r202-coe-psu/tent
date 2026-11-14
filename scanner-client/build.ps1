<#
.SYNOPSIS
  Build scanner-client for Windows: venv -> pytest -> pyinstaller (normal + debug) -> zip + installer.

.DESCRIPTION
  Run on a Windows machine (PyInstaller does not cross-compile): double-click build.bat, or
      powershell -ExecutionPolicy Bypass -File .\build.ps1
  Needs internet only: uses `uv` from PATH, else downloads it into .tools\; uv fetches Python.
  Same for Inno Setup (ISCC.exe), downloaded into .tools\inno when not installed.
  Output (in dist\):
      tent-win64.zip                   tent\ folder: double-click tent.exe (python.org's signed
                                       pythonw.exe renamed), passes Smart App Control
      scanner-client-setup.exe         per-user installer (Inno Setup, installer.iss); asks
                                       SHELTER_URL, adds shortcuts + an uninstall entry
      scanner-client-win64.zip         scanner-client\ (onedir, console-less) + README.md
                                       (.env.example + install-shortcut.bat are inside
                                        scanner-client\, next to the .exe)
      scanner-client-debug-win64.zip   scanner-client-debug\ (same code, with a console window)
  Needs the kiosk checkout next to this folder (..\kiosk provides app\scard.py).
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

# Windows PowerShell 5.1 does not stop on a failing native command, so check every one.
function Invoke-Checked {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
    Write-Host ">> $Exe $($Arguments -join ' ')"
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Exe failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path -LiteralPath '..\kiosk\app\scard.py')) {
    throw 'Missing ..\kiosk\app\scard.py (scanner-client reuses the kiosk card reader module).'
}

# uv on PATH wins; otherwise a private copy in .tools\ (downloaded once, no admin, PATH untouched).
# uv then fetches a managed Python itself, so the build machine needs neither uv nor Python.
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if ($uvCmd) {
    $uv = $uvCmd.Source
} else {
    $toolsDir = Join-Path $PSScriptRoot '.tools'
    $uv = Join-Path $toolsDir 'uv.exe'
    if (-not (Test-Path -LiteralPath $uv)) {
        Write-Host ">> installing uv into $toolsDir"
        $env:UV_INSTALL_DIR = $toolsDir
        $env:UV_NO_MODIFY_PATH = '1'
        try {
            # Separate process: the installer must not inherit this script's StrictMode.
            # Windows PowerShell 5.1 may default to TLS 1.0, which astral.sh rejects.
            Invoke-Checked 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
                "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; irm https://astral.sh/uv/install.ps1 | iex")
        } finally {
            Remove-Item Env:\UV_INSTALL_DIR, Env:\UV_NO_MODIFY_PATH -ErrorAction SilentlyContinue
        }
        if (-not (Test-Path -LiteralPath $uv)) { throw "uv install did not produce $uv" }
    }
}

Invoke-Checked $uv @('sync', '--group', 'build')
$run = { param([string[]]$a) Invoke-Checked $uv (@('run', '--group', 'build') + $a) }

# 1. tests must pass before anything is packaged
& $run @('pytest', '-q')

# 2. clean, then build the normal (console-less) and debug (console) onedir folders
foreach ($dir in 'build', 'dist') {
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
}

Remove-Item Env:\SCANNER_CLIENT_DEBUG -ErrorAction SilentlyContinue
& $run @('pyinstaller', 'scanner-client.spec', '--noconfirm', '--workpath', 'build\normal')

$env:SCANNER_CLIENT_DEBUG = '1'
try {
    & $run @('pyinstaller', 'scanner-client.spec', '--noconfirm', '--workpath', 'build\debug')
} finally {
    Remove-Item Env:\SCANNER_CLIENT_DEBUG -ErrorAction SilentlyContinue
}

foreach ($exe in 'dist\scanner-client\scanner-client.exe', 'dist\scanner-client-debug\scanner-client-debug.exe') {
    if (-not (Test-Path -LiteralPath $exe)) { throw "Build did not produce $exe" }
}

# 3. package: the .env is read next to the .exe, so .env.example goes inside the onedir folder,
#    with the shortcut installer (it targets the .exe in its own folder)
foreach ($folder in 'scanner-client', 'scanner-client-debug') {
    foreach ($file in '.env.example', 'install-shortcut.bat', 'install-shortcut.ps1') {
        Copy-Item -LiteralPath $file -Destination "dist\$folder\$file"
    }
}

$zip = 'dist\scanner-client-win64.zip'
$debugZip = 'dist\scanner-client-debug-win64.zip'
Compress-Archive -LiteralPath 'dist\scanner-client', 'README.md' -DestinationPath $zip -Force
Compress-Archive -LiteralPath 'dist\scanner-client-debug' -DestinationPath $debugZip -Force

# 4. installer payload (build\embed): Smart App Control blocks the unsigned PyInstaller .exe, so
#    the installer ships the python.org embeddable runtime (PSF-signed pythonw.exe + DLLs) and our
#    code as plain .py files. The card reader goes through the signed winscard.dll (ctypes), so
#    greenlet's .pyd is the only unsigned native file left.
#      build\embed\python\         embeddable Python, python313._pth points at .. and ..\site-packages
#      build\embed\site-packages\  runtime deps from uv.lock (Windows wheels)
#      build\embed\scanner_client\ + app\scard.py (kiosk)   -> pythonw.exe -m scanner_client.main
$embedVersion = '3.13.17'
$embedSha256 = '9E35319BFFEDAB8B36AD44D8F377CB4F1733BCEC257A0B6D04D94F01486DDB38'
$embedZip = Join-Path $PSScriptRoot ".tools\python-$embedVersion-embed-amd64.zip"
if (-not (Test-Path -LiteralPath $embedZip)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $embedZip) | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
    Invoke-WebRequest -UseBasicParsing -OutFile $embedZip `
        -Uri "https://www.python.org/ftp/python/$embedVersion/python-$embedVersion-embed-amd64.zip"
}
$hash = (Get-FileHash -LiteralPath $embedZip -Algorithm SHA256).Hash
if ($hash -ne $embedSha256) {
    Remove-Item -LiteralPath $embedZip -Force
    throw "Python embeddable checksum mismatch ($hash)"
}

$stage = 'build\embed'
Expand-Archive -LiteralPath $embedZip -DestinationPath "$stage\python" -Force
# ._pth paths are relative to python\; it also keeps PYTHONPATH and user site-packages out.
Set-Content -LiteralPath "$stage\python\python313._pth" -Encoding ascii -Value @(
    'python313.zip', '.', '..', '..\site-packages')

Invoke-Checked $uv @('export', '--frozen', '--no-dev', '--no-emit-project', '--no-hashes',
    '--quiet', '-o', 'build\requirements.txt')
Invoke-Checked $uv @('pip', 'install', '--quiet', '--target', "$stage\site-packages",
    '-r', 'build\requirements.txt', '--only-binary', ':all:',
    '--python-platform', 'x86_64-pc-windows-msvc', '--python-version', '3.13')
Remove-Item -LiteralPath "$stage\site-packages\greenlet\tests" -Recurse -Force -ErrorAction SilentlyContinue

Copy-Item -LiteralPath 'scanner_client' -Destination "$stage\scanner_client" -Recurse
New-Item -ItemType Directory -Force -Path "$stage\app" | Out-Null
foreach ($file in '__init__.py', 'scard.py') {
    Copy-Item -LiteralPath "..\kiosk\app\$file" -Destination "$stage\app\$file"
}
Get-ChildItem -LiteralPath $stage -Recurse -Directory -Filter '__pycache__' |
    Remove-Item -Recurse -Force
foreach ($file in '.env.example', 'README.md', 'assets\tent.ico') {
    Copy-Item -LiteralPath $file -Destination $stage
}

# smoke test: the embedded runtime must import the app and every native dependency
Invoke-Checked "$stage\python\python.exe" @('-c',
    ('import scanner_client.main, app.scard, greenlet, playwright.async_api; ' +
     'from scanner_client.winscard import WinSCard; WinSCard.load()'))
Get-ChildItem -LiteralPath $stage -Recurse -Directory -Filter '__pycache__' |
    Remove-Item -Recurse -Force

# 4b. zip with no .exe of ours: python.org's PSF-signed pythonw.exe renamed to tent.exe (the
#     signature covers the file's bytes, not its name). Double-clicked with no arguments, it
#     imports zip\sitecustomize.py, which makes the shortcuts and runs the client. Only what
#     tent.exe must load from its own folder stays on top, so staff find tent.exe at a glance:
#       tent\tent.exe, python.exe, python313.dll, python3.dll, vcruntime140*.dll, python313._pth
#       tent\.env.example, README.md, tent.ico      (.env is written here too)
#       tent\lib\  .pyd + their dlls, python313.zip, site-packages, scanner_client, app,
#                  sitecustomize.py (an extension's dlls load from the extension's own folder)
$zipStage = 'build\zip\tent'
$zipLib = "$zipStage\lib"
New-Item -ItemType Directory -Force -Path $zipLib | Out-Null
$topLevel = 'python.exe', 'pythonw.exe', 'python313.dll', 'python3.dll', 'vcruntime140.dll',
    'vcruntime140_1.dll'
foreach ($item in Get-ChildItem -LiteralPath "$stage\python") {
    if ($item.Name -eq 'python313._pth') { continue }
    $to = if ($topLevel -contains $item.Name) { $zipStage } else { $zipLib }
    Copy-Item -LiteralPath $item.FullName -Destination $to -Recurse
}
foreach ($dir in 'site-packages', 'scanner_client', 'app') {
    Copy-Item -LiteralPath "$stage\$dir" -Destination "$zipLib\$dir" -Recurse
}
foreach ($file in '.env.example', 'README.md', 'tent.ico') {
    Copy-Item -LiteralPath "$stage\$file" -Destination $zipStage
}
Copy-Item -LiteralPath 'zip\sitecustomize.py' -Destination $zipLib
Move-Item -LiteralPath "$zipStage\pythonw.exe" -Destination "$zipStage\tent.exe"
# paths are relative to the ._pth; `import site` is what makes Python import sitecustomize.py
Set-Content -LiteralPath "$zipStage\python313._pth" -Encoding ascii -Value @(
    'lib\python313.zip', 'lib', 'lib\site-packages', 'import site')
foreach ($exe in 'tent.exe', 'python.exe') {
    $signature = Get-AuthenticodeSignature -LiteralPath "$zipStage\$exe"
    if ($signature.Status -ne 'Valid') { throw "$exe is not validly signed ($($signature.Status))" }
}
# python.exe (not tent.exe) must stay plain Python: this would hang if it launched the client
Invoke-Checked "$zipStage\python.exe" @('-c',
    ('import sys, sitecustomize, ssl, ctypes, scanner_client.main, scanner_client.launcher; ' +
     'from pathlib import Path; from scanner_client.winscard import WinSCard; WinSCard.load(); ' +
     'assert scanner_client.main.default_env_path().parent == Path(sys.executable).parent; ' +
     'from scanner_client.label_printers import _win_printer_exists; ' +
     'assert not _win_printer_exists(''tent-no-such-printer'')'))
# tent.exe writes its own shortcuts through COM on the first start: write one here to prove it
$lnkTest = Join-Path ([IO.Path]::GetTempPath()) 'tent-build-shortcut-test.lnk'
Remove-Item -LiteralPath $lnkTest -ErrorAction SilentlyContinue
Invoke-Checked "$zipStage\python.exe" @('-c',
    ('import sys; from pathlib import Path; from scanner_client import shortcuts as s; ' +
     'exe = Path(sys.executable); s.save_shortcut(s.Shortcut(Path(sys.argv[1]), exe, ' +
     'exe.parent, exe.parent / s.ICON_NAME)); s.shortcut_folders()'), $lnkTest)
if (-not (Test-Path -LiteralPath $lnkTest)) { throw 'shortcut smoke test wrote no .lnk' }
Remove-Item -LiteralPath $lnkTest
Get-ChildItem -LiteralPath $zipStage -Recurse -Directory -Filter '__pycache__' |
    Remove-Item -Recurse -Force
$tentZip = 'dist\tent-win64.zip'
Compress-Archive -LiteralPath $zipStage -DestinationPath $tentZip -Force

# 5. installer (Inno Setup): ISCC from PATH / a normal install, else a private copy in .tools\
$iscc = @(
    (Get-Command iscc -ErrorAction SilentlyContinue | ForEach-Object Source),
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
    (Join-Path $PSScriptRoot '.tools\inno\ISCC.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $iscc) {
    $innoDir = Join-Path $PSScriptRoot '.tools\inno'
    # Pinned release asset: jrsoftware.org/download.php/is.exe redirects to an HTML page.
    $innoUrl = 'https://github.com/jrsoftware/issrc/releases/download/is-6_7_4/innosetup-6.7.4.exe'
    $innoSha256 = 'A549929319F9120716677C685535CA4671E4B937B5FDC87E2585F32D8EB30E8C'
    $innoSetup = Join-Path $PSScriptRoot '.tools\innosetup-6.7.4.exe'
    Write-Host ">> installing Inno Setup into $innoDir"
    [Net.ServicePointManager]::SecurityProtocol = 'Tls12'
    Invoke-WebRequest -UseBasicParsing -Uri $innoUrl -OutFile $innoSetup
    $hash = (Get-FileHash -LiteralPath $innoSetup -Algorithm SHA256).Hash
    if ($hash -ne $innoSha256) {
        Remove-Item -LiteralPath $innoSetup -Force
        throw "Inno Setup download checksum mismatch ($hash)"
    }
    $p = Start-Process -FilePath $innoSetup -Wait -PassThru -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/NOICONS', "/DIR=`"$innoDir`"")
    if ($p.ExitCode -ne 0) { throw "Inno Setup install failed with exit code $($p.ExitCode)" }
    $iscc = Join-Path $innoDir 'ISCC.exe'
    if (-not (Test-Path -LiteralPath $iscc)) { throw "Inno Setup install did not produce $iscc" }
}
$version = (Select-String -LiteralPath 'pyproject.toml' -Pattern '^version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
Invoke-Checked $iscc @("/DAppVersion=$version", 'installer.iss')
$setup = 'dist\scanner-client-setup.exe'
if (-not (Test-Path -LiteralPath $setup)) { throw "Build did not produce $setup" }

foreach ($z in $setup, $tentZip, $zip, $debugZip) {
    $mb = [math]::Round((Get-Item -LiteralPath $z).Length / 1MB, 1)
    Write-Host "OK  $z  ($mb MB)"
}
