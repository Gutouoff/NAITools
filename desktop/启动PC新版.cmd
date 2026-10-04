@echo off
setlocal
set "APP=%~dp0target\release\naitools.exe"
if not exist "%APP%" (
  echo PC Preview EXE not found. See README.md for build instructions.
  pause
  exit /b 1
)
start "" "%APP%"
