@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Installing dependencies...
call npm install
if errorlevel 1 goto :fail

echo Building...
call npm run build
if errorlevel 1 goto :fail

echo Linking the global "brain" command...
call npm link
if errorlevel 1 goto :fail

for /f "delims=" %%p in ('npm config get prefix') do set NPM_PREFIX=%%p
echo %PATH% | find /i "%NPM_PREFIX%" >nul
if errorlevel 1 (
  echo.
  echo "%NPM_PREFIX%" isn't on PATH yet, so "brain" won't be found in a new terminal.
  echo Adding it now...
  setx PATH "%PATH%;%NPM_PREFIX%" >nul
  echo Done — open a NEW terminal for this to take effect.
)

echo.
echo Writing a drag-anywhere launcher...
call brain --write-launcher . >nul

echo.
echo BrAIn is installed. Simplest way to use it on a project: drag-and-drop
echo   "%~dp0Start BrAIn.bat"
echo into that project's folder and double-click it there. First time in a new folder, it asks
echo which profile that project is for (dev or notes); after that it just opens the browser.
echo.
echo Want BrAIn registered as an MCP server for Claude Code too (so an AI can use it directly)?
echo   brain --init "C:\path\to\project"
echo does that in the same step, on top of everything the drag-and-drop launcher does. See
echo README.md for other AI clients (Cursor, Claude Desktop, Windsurf, Cline).
pause
exit /b 0

:fail
echo.
echo Install failed — see the error above.
pause
exit /b 1
