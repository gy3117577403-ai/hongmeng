#!/bin/sh
set -eu
test "${THREE_FIXES_QA_ALLOW:-}" = disposable-three-fixes-runtime
npx tsx scripts/seed-three-fixes-smoke.ts
node scripts/smoke-three-fixes-browser.mjs
