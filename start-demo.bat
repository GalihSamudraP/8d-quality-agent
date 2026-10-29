@echo off
rem Starts the demo: the Python agent and the Next.js UI in two cmd windows, then opens the workspace.
rem Usage: start-demo.bat [sap^|mock]   (default: sap)
setlocal

set "ROOT=%~dp0"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=sap"
if /I "%MODE%"=="sap" set "MODE=sap"
if /I "%MODE%"=="mock" set "MODE=mock"
if not "%MODE%"=="sap" if not "%MODE%"=="mock" (
    echo Unknown mode "%~1". Use: start-demo.bat [sap^|mock]
    pause
    exit /b 1
)

if not exist "%ROOT%agent\.venv\Scripts\python.exe" (
    echo agent\.venv not found. Set it up first, see agent\README.md.
    pause
    exit /b 1
)
if not exist "%ROOT%node_modules" (
    echo node_modules not found. Run "npm install" in the repo root first.
    pause
    exit /b 1
)

set "KEY_FILE=%USERPROFILE%\sap-keys\aicore-key.json"
if "%MODE%"=="sap" if not exist "%KEY_FILE%" (
    echo SAP AI Core key file not found: %KEY_FILE%
    echo Put the service key there, or run the demo without SAP:  start-demo.bat mock
    pause
    exit /b 1
)

rem Variables set here are inherited by the window started next.
set "AGENT_MODE=%MODE%"
if "%MODE%"=="sap" (
    set "SAP_AICORE_KEY_FILE=%KEY_FILE%"
    set "SAP_DEPLOYMENT_ID=d1a82575de60e02a"
    set "SAP_MODEL_NAME=gpt-5.4"
)
start "8D Agent" /D "%ROOT%agent" cmd /k ".venv\Scripts\python -m quality_agent.app"

set "AGENT_MODE="
set "SAP_AICORE_KEY_FILE="
set "SAP_DEPLOYMENT_ID="
set "SAP_MODEL_NAME="
set "NEXT_PUBLIC_AGENT_BACKEND=local"
set "AGENT_URL=http://127.0.0.1:8080"
rem npm run dev listens on 127.0.0.1 only; the agent also binds 127.0.0.1 outside Docker.
start "8D Web" /D "%ROOT%." cmd /k "npm run dev"

echo Agent mode: %MODE%. Waiting for http://127.0.0.1:3000 ...
set /a TRIES=0
:wait
timeout /t 3 /nobreak >nul
set /a TRIES+=1
curl.exe -s -o nul --max-time 5 http://127.0.0.1:3000/workspace && goto open
if %TRIES% lss 30 goto wait
echo The web server did not answer yet; opening the browser anyway.
:open
start "" "http://127.0.0.1:3000/workspace"
endlocal
