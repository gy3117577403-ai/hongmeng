#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  release) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/hongmeng_ci?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3000 ;;
  hangzhou) export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:25437/hongmeng_sample_mirror?schema=public' SMOKE_BASE_URL=http://127.0.0.1:3300 ;;
  *) echo 'Expected release or hangzhou disposable runtime' >&2; exit 1 ;;
esac
export QUALITY_CORRECTION_QA_ALLOW=disposable-quality-correction
export QUALITY_CORRECTION_QA_REPORT="output/quality-correction/$1-acceptance.json"
npx tsx scripts/seed-quality-correction-qa.ts
npx tsx scripts/smoke-quality-correction.ts
rm output/quality-correction/fixture.json

export LINKED_QUALITY_QA=1
export QUALITY_CORRECTION_QA_REPORT="output/quality-correction/$1-linked-acceptance.json"
npx tsx scripts/seed-quality-correction-qa.ts
npx tsx scripts/smoke-quality-correction.ts
rm output/quality-correction/fixture.json
