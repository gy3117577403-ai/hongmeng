#!/bin/sh
set -eu
test "${OFFICE_QA_ALLOW:-}" = disposable-office-runtime
npx tsx scripts/seed-knowledge-preview-smoke.ts
node scripts/smoke-knowledge-preview-browser.mjs
node scripts/smoke-knowledge-preview-http.mjs
