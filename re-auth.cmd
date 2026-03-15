@echo off
echo ================================================
echo Re-Auth Copilot API Server at %~dp0
echo ================================================
echo.

ECHO Re Authing Copilot-Api service...

CALL cmd /c "CD /D %~dp0 && npm run auth"

pause
