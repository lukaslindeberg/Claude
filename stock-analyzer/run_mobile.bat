@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo Checking virtual environment...
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)

echo Checking FastAPI and uvicorn...
python -c "import fastapi, uvicorn" 2>nul
if errorlevel 1 (
    echo Installing FastAPI and uvicorn...
    pip install "fastapi>=0.110.0" "uvicorn[standard]>=0.29.0" --quiet
)

echo Detecting local IP address...
for /f "tokens=*" %%i in ('python -c "import socket; s=socket.socket(); s.connect((\"8.8.8.8\",80)); print(s.getsockname()[0]); s.close()" 2^>nul') do set LOCAL_IP=%%i
if not defined LOCAL_IP set LOCAL_IP=127.0.0.1

set PORT=8080
if defined PORT_OVERRIDE set PORT=%PORT_OVERRIDE%

echo.
echo ================================================
echo   Intrinsic -- Mobile PWA
echo   Know what it's really worth
echo ================================================
echo.
echo   Desktop:   http://localhost:%PORT%
echo.
echo   iPhone / iPad (same WiFi network):
echo   -^>  http://%LOCAL_IP%:%PORT%
echo.
echo   On your iPhone:
echo   1. Open Safari and go to the URL above
echo   2. Tap the Share icon  (box with arrow)
echo   3. Tap "Add to Home Screen"
echo   4. Tap "Add" -- works like a native app!
echo.
echo   Press Ctrl+C to stop.
echo ================================================
echo.

python -m uvicorn api:app --host 0.0.0.0 --port %PORT% --log-level warning

pause
