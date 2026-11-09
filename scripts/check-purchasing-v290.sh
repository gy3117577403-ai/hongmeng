#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  release) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/hongmeng_ci?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3000 ;;
  hangzhou) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:25437/hongmeng_sample_mirror?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3300 ;;
  *) echo 'Expected release or hangzhou disposable runtime' >&2; exit 1 ;;
esac
export PURCHASING_QA_ALLOW=disposable-purchasing-runtime
export PURCHASING_V290_FIXTURE="$RUNNER_TEMP/purchasing-v290-$1.json"
export PURCHASING_V290_OUTPUT="output/playwright/purchasing-v290-$1"
npx tsx scripts/seed-purchasing-v290-smoke.ts
node scripts/smoke-purchasing-v290-browser.mjs
