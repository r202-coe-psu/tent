@echo off
rem Double-click to create tent shortcuts on the Desktop and in the Start Menu.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-shortcut.ps1"
pause
