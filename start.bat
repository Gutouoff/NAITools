@echo off
setlocal
cd /d "%~dp0"

set "APP_EXE=%~dp0desktop\target\release\naitools.exe"
if not exist "%APP_EXE%" (
  echo NAITools PC executable not found:
  echo %APP_EXE%
  echo.
  echo Build from the desktop directory: npm ci ^&^& npm run desktop:build
  echo See README.md for prerequisites and data backup instructions.
  pause
  exit /b 1
)

start "" "%APP_EXE%"
exit /b 0
