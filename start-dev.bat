@echo off
echo Starting flight-visualizer dev server...

REM Add Node.js to PATH
set "PATH=C:\Program Files\nodejs;%PATH%"

cd /d "%~dp0"

echo Installing dependencies...
call npm install

echo Starting dev server...
call npm run dev

pause
