#!/usr/bin/env bash
set -e

echo "==> Installing dependencies..."
npm install

echo "==> Compiling TypeScript..."
npx tsc

echo "==> Copying static assets..."
mkdir -p dist/web/public
cp -r src/web/public/* dist/web/public/

echo "==> Done."
echo "    Run ./cli.sh <fixture> to build a PSBT."
echo "    Run ./web.sh to start the HTTP server."
