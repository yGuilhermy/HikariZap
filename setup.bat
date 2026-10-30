@echo off
pushd "%~dp0"
call npm ci
if errorlevel 1 exit /b 1
if not exist .env copy .env_example .env >nul
echo Configure .env e execute npm start para parear a Hikari Zap.
popd
