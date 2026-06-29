@echo off
REM Windows: double-click this file to open the Traffic Light setup.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    py setup.py
    goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
    python setup.py
    goto :eof
)
echo Python was not found. Install it from https://www.python.org/downloads/
echo (On the first install screen, tick "Add python.exe to PATH".)
pause
