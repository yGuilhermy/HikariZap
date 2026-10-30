#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
node --version
npm ci
if [ ! -f .env ]; then cp .env_example .env; fi
printf '%s\n' 'Configure .env e execute npm start para parear a Hikari Zap.'
