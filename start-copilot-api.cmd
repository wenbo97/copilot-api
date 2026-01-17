@echo off
echo ================================================
echo GitHub Copilot API Server with Usage Viewer
echo Start Copilot API Server at %~dp0
echo ================================================
echo.

ECHO Starting Copilot-Api service...

CALL CD /D %~dp0 && npm run dev

pause
