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
echo BrAIn is installed. Next, for any project you want to use it with:
echo   brain --init "C:\path\to\project"
echo That writes a double-clickable launcher AND registers BrAIn as an MCP server for Claude Code,
echo both in one step. See README.md for other AI clients (Cursor, Claude Desktop, Windsurf, Cline).
pause
exit /b 0

:fail
echo.
echo Install failed — see the error above.
pause
exit /b 1
