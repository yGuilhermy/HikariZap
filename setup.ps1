$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node --version
if ($LASTEXITCODE -ne 0) { throw 'Instale Node.js 20 ou superior.' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'Falha na instalação das dependências.' }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env_example' -Destination '.env' }
Write-Output 'Configure .env e execute npm start para parear a Hikari Zap.'
