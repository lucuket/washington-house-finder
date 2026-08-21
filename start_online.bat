@echo off
title Washington Home Search - Online Server
echo ========================================================
echo   Starting Washington Home Search Online Server
echo ========================================================
echo.

:: Start FastAPI in background
start /B python -m uvicorn app:app --host 127.0.0.1 --port 8000

:: Start Cloudflare Tunnel
echo Starting Secure Cloudflare Tunnel...
cloudflared.exe tunnel --url http://127.0.0.1:8000
pause
