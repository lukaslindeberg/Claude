@echo off
:: ─────────────────────────────────────────────────────────
::  Intrinsic — Know what it's really worth (Windows launcher)
:: ─────────────────────────────────────────────────────────
cd /d "%~dp0"
title Intrinsic

if not exist "venv\" (
    echo Virtual environment not found. Please run install.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
echo Starting Intrinsic -- opening in your browser...
streamlit run app.py --server.headless false
