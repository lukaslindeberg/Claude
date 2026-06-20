@echo off
:: ─────────────────────────────────────────────────────────
::  Stock DCF Analyzer — Launcher (Windows)
:: ─────────────────────────────────────────────────────────
cd /d "%~dp0"
title Stock DCF Analyzer

if not exist "venv\" (
    echo Virtual environment not found. Please run install.bat first.
    pause
    exit /b 1
)

call venv\Scripts\activate.bat
echo Starting Stock DCF Analyzer -- opening in your browser...
streamlit run app.py --server.headless false
