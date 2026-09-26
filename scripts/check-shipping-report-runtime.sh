#!/usr/bin/env bash
set -euo pipefail
: "${SHIPPING_QA_OUTPUT:=output/playwright/shipping-report-runtime}"
export SHIPPING_QA_OUTPUT SHIPPING_QA_ALLOW=disposable-shipping-reports
SHIPPING_QA_FIXTURE="$(mktemp "${RUNNER_TEMP:-/tmp}/shipping-fixture.XXXXXX.json")"
export SHIPPING_QA_FIXTURE
trap 'rm -f "$SHIPPING_QA_FIXTURE"' EXIT
node scripts/seed-shipping-report-smoke.cjs
node scripts/smoke-shipping-report-browser.mjs
