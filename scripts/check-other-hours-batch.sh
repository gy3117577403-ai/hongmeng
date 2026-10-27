#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  release) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/hongmeng_ci?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3000 S3_ENDPOINT=http://127.0.0.1:19000 ;;
  hangzhou) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:25437/hongmeng_sample_mirror?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3300 S3_ENDPOINT=http://127.0.0.1:29000 ;;
  *) echo 'Expected release or hangzhou disposable runtime' >&2; exit 1 ;;
esac
export OTHER_HOURS_QA_ALLOW=disposable-other-hours-batch
export S3_BUCKET=workorder-resources S3_REGION=auto S3_FORCE_PATH_STYLE=true
export OTHER_HOURS_QA_FIXTURE="$RUNNER_TEMP/other-hours-batch-$1.json"
export OTHER_HOURS_QA_OUTPUT="output/playwright/other-hours-batch-$1"
npx tsx scripts/seed-other-hours-batch-qa.ts
node scripts/smoke-other-hours-batch-browser.mjs
