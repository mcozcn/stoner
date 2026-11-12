@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun, sonra tekrar deneyin.
  pause
  exit /b 1
)
node server.js --open
pause
