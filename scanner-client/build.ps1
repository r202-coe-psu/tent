<#
.SYNOPSIS
  Build scanner-client for Windows: venv -> pytest -> pyinstaller (normal + debug) -> zip + installer.

.DESCRIPTION
  Run on a Windows machine (PyInstaller does not cross-compile): double-click build.bat, or
      powershell -ExecutionPolicy Bypass -File .\build.ps1
  Needs internet only: uses `uv` from PATH, else downloads it into .tools\; uv fetches Python.
  Same for Inno Setup (ISCC.exe), downloaded into .tools\inno when not installed.
  Output (in dist\):
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

# 4. installer (Inno Setup): ISCC from PATH / a normal install, else a private copy in .tools\
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

foreach ($z in $setup, $zip, $debugZip) {
    $mb = [math]::Round((Get-Item -LiteralPath $z).Length / 1MB, 1)
    Write-Host "OK  $z  ($mb MB)"
}
