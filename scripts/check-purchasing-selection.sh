#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  release) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/hongmeng_ci?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3000 ;;
  hangzhou) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:25437/hongmeng_sample_mirror?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3300 ;;
  *) echo 'Expected release or hangzhou disposable runtime' >&2; exit 1 ;;
esac
export PURCHASING_QA_ALLOW=disposable-purchasing-runtime
export PURCHASING_SELECTION_FIXTURE="$RUNNER_TEMP/purchasing-selection-$1.json"
export PURCHASING_SELECTION_OUTPUT="output/playwright/purchasing-selection-$1"
npx tsx scripts/seed-purchasing-selection-smoke.ts
node scripts/smoke-purchasing-selection-browser.mjs
