@echo off
:: ─────────────────────────────────────────────────────────
::  Intrinsic — Know what it's really worth (Windows installer)
:: ─────────────────────────────────────────────────────────
cd /d "%~dp0"
title Intrinsic - Installation

echo.
echo =====================================================
echo    Intrinsic -- Know what it's really worth
echo    Installation
echo =====================================================
echo.

:: ── Python ──────────────────────────────────────────────
echo [1/4] Checking Python...

python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Python not found.
    echo.
    echo  Please install Python 3.9+ from: https://www.python.org/downloads/
    echo  IMPORTANT: Check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo   OK - Python %PYVER% found

:: ── Virtual environment ──────────────────────────────────
echo.
echo [2/4] Setting up virtual environment...

if not exist "venv\" (
    python -m venv venv
    echo   OK - Virtual environment created
) else (
    echo   OK - Virtual environment already exists
)

call venv\Scripts\activate.bat

:: ── Python packages ──────────────────────────────────────
echo.
echo [3/4] Installing Python packages (this may take a minute)...

pip install --upgrade pip -q
pip install -r requirements.txt -q
if errorlevel 1 (
    echo   ERROR: Package installation failed.
    pause
    exit /b 1
)
echo   OK - All packages installed

:: ── Ollama ───────────────────────────────────────────────
echo.
echo [4/4] Checking Ollama (local AI)...

ollama --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo   NOTE: Ollama not found.
    echo   To enable AI features:
    echo   1. Download Ollama from https://ollama.ai
    echo   2. Install and run it
    echo   3. Open a terminal and run: ollama pull llama3.2
    echo.
    echo   The app works without Ollama (financial data only).
) else (
    echo   OK - Ollama is installed

    ollama list >nul 2>&1
    if errorlevel 1 (
        echo   NOTE: Ollama is not running. Start it from the system tray or run: ollama serve
    ) else (
        for /f %%c in ('ollama list 2^>nul ^| find /c /v ""') do set MCOUNT=%%c
        if %MCOUNT% LEQ 1 (
            echo   Downloading llama3.2 model (about 2 GB)...
            ollama pull llama3.2
            echo   OK - llama3.2 downloaded
        ) else (
            echo   OK - Models available
        )
    )
)

:: ── Done ─────────────────────────────────────────────────
echo.
echo =====================================================
echo    Installation complete!
echo =====================================================
echo.
echo  To start the app, double-click run.bat
echo.
pause
