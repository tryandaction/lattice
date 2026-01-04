@echo off
echo Starting Lattice Desktop App...
echo.
start "" "src-tauri\target\release\lattice.exe"
echo Application launched!
timeout /t 2 >nul
