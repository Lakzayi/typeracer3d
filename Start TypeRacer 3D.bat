@echo off
title TypeRacer 3D
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ❌ Node.js is not installed. Get it from https://nodejs.org
  pause
  exit /b 1
)

echo 🏁 Starting TypeRacer 3D...
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8787"
node server.js

echo.
echo Server stopped.
pause
