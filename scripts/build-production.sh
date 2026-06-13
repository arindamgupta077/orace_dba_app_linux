#!/usr/bin/env bash
# Production build script for RHEL 9.7 — run from the project root after npm ci.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found in PATH" >&2
  exit 1
fi

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [[ "${NODE_MAJOR}" -lt 24 ]]; then
  echo "warning: Node $(node -v) detected; this app targets Node 24+" >&2
fi

if [[ ! -f .env.local ]]; then
  echo "error: .env.local not found — copy .env.example and configure for production" >&2
  exit 1
fi

export NODE_ENV=production
npm run build
echo "Build complete. Start with: npm run start"
