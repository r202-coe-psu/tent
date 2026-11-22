@echo off
rem Double-click to build dist\scanner-client-win64.zip (downloads uv + Python if missing).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
pause
