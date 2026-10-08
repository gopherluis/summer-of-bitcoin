#!/usr/bin/env bash
set -e

if [ ! -f "dist/cli.js" ]; then
  echo "Error: dist/cli.js not found. Run ./setup.sh first." >&2
  exit 1
fi

node dist/cli.js "$1"
