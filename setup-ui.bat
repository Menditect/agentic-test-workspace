@echo off
cd /d "%~dp0"
node scripts/setup.js --ui
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Could not start the Menditect Visual Setup Wizard. Ensure Node.js is installed.
  pause
)
