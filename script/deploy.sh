#!/usr/bin/env bash
# Build the site and publish dist/ to the gh-pages branch (GitHub Pages).
set -euo pipefail

cd "$(dirname "$0")/.."

# Without the production CARTO key the map falls back to Esri tiles, so
# refuse to deploy rather than ship that by accident.
if ! grep -qE '^VITE_CARTO_KEY=.+' .env 2>/dev/null; then
  echo "VITE_CARTO_KEY is not set in .env; aborting deploy." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: uncommitted changes will be included in this deploy." >&2
fi

npm run build

cd dist
# Vite empties dist/ but keeps .git; start fresh each time.
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q --allow-empty -m "deploy $(git -C .. rev-parse --short HEAD)"
git push -f https://github.com/blheson/yyc-bus-audit.git gh-pages

echo "Deployed: https://blheson.github.io/yyc-bus-audit/"
