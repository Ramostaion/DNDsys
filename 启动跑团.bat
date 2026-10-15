@echo off
setlocal
cd /d "%~dp0"
title Project DND - Close this window to stop
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dnd.ps1" %*
set "DND_EXIT_CODE=%ERRORLEVEL%"
if not "%DND_EXIT_CODE%"=="0" pause
exit /b %DND_EXIT_CODE%
