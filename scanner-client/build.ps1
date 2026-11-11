<#
.SYNOPSIS
  Build scanner-client for Windows: venv -> pytest -> pyinstaller (normal + debug) -> zip.

.DESCRIPTION
  Run manually on a Windows machine (PyInstaller does not cross-compile):
      powershell -ExecutionPolicy Bypass -File .\build.ps1
  Uses `uv` when installed, otherwise `py -3.12 -m venv` + pip.
  Output (in dist\):
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

$useUv = $null -ne (Get-Command uv -ErrorAction SilentlyContinue)
if ($useUv) {
    Invoke-Checked 'uv' @('sync', '--group', 'build')
    $run = { param([string[]]$a) Invoke-Checked 'uv' (@('run', '--group', 'build') + $a) }
} else {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        Invoke-Checked 'py' @('-3.12', '-m', 'venv', '.venv')
    }
    $py = (Resolve-Path -LiteralPath '.venv\Scripts\python.exe').Path
    Invoke-Checked $py @('-m', 'pip', 'install', '--upgrade', 'pip')
    Invoke-Checked $py @('-m', 'pip', 'install', '-e', '.', 'pytest>=8.0', 'pyinstaller>=6.0')
    $scripts = Split-Path -Parent $py
    # $a[0] is the tool name (pytest / pyinstaller), the rest its arguments
    $run = { param([string[]]$a) Invoke-Checked (Join-Path $scripts "$($a[0]).exe") $a[1..($a.Count - 1)] }
}

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

foreach ($z in $zip, $debugZip) {
    $mb = [math]::Round((Get-Item -LiteralPath $z).Length / 1MB, 1)
    Write-Host "OK  $z  ($mb MB)"
}
