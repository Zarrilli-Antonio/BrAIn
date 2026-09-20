@echo off
where brain >nul 2>nul
if errorlevel 1 (
  echo BrAIn is not installed globally yet.
  echo Run this once from the BrAIn project folder: npm link
  pause
  exit /b 1
)
brain --mode http --root "%~dp0." --port 4173 --open
if errorlevel 1 (
  echo.
  echo BrAIn failed to start.
  pause
)
