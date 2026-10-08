#!/usr/bin/env bash
set -e

if [ ! -f "dist/web/server.js" ]; then
  echo "Error: dist/web/server.js not found. Run ./setup.sh first." >&2
  exit 1
fi

node dist/web/server.js
