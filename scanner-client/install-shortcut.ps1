<#
.SYNOPSIS
  Create "tent" shortcuts (Desktop + Start Menu) for the scanner-client.exe next to
  this script. No admin needed. Run via install-shortcut.bat (double-click).
  Re-run after moving the folder: shortcuts point at the absolute .exe path.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Shipped in both scanner-client\ and scanner-client-debug\; target whichever .exe is here.
$exe = Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'scanner-client*.exe' | Select-Object -First 1
if (-not $exe) {
    throw "scanner-client.exe not found in $PSScriptRoot - keep this script inside the extracted folder."
}
$name = if ($exe.BaseName -like '*-debug') { 'tent (debug)' } else { 'tent' }

$shell = New-Object -ComObject WScript.Shell
# GetFolderPath follows OneDrive-redirected Desktops; 'Programs' is the per-user Start Menu.
foreach ($dir in [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) {
    $path = Join-Path $dir "$name.lnk"
    $lnk = $shell.CreateShortcut($path)
    $lnk.TargetPath = $exe.FullName
    # .env is read next to the .exe; keep the working directory there too.
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.IconLocation = "$($exe.FullName),0"
    $lnk.Description = 'Read Thai ID cards into the shelter walk-in registration page'
    $lnk.Save()
    Write-Host "OK  $path"
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env'))) {
    Write-Warning ".env is missing: copy .env.example to .env in $PSScriptRoot and set SHELTER_URL before starting."
}
