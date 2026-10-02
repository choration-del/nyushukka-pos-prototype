@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "POS_NODE=%~dp0runtime\node.exe"
if exist "%POS_NODE%" goto run
set "POS_NODE=node"
where node >nul 2>nul
if errorlevel 1 goto missing
:run
"%POS_NODE%" "%~dp0launcher.js" %*
set "POS_EXIT=%ERRORLEVEL%"
if not "%POS_EXIT%"=="0" if not defined POS_NONINTERACTIVE pause
exit /b %POS_EXIT%
:missing
echo Runtime not found. Extract the entire ZIP including runtime\node.exe.
if not defined POS_NONINTERACTIVE pause
exit /b 1
