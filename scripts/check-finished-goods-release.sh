#!/bin/sh
set -eu
mkdir -p artifacts/finished-goods
docker exec -i -e FINISHED_GOODS_QA_ALLOW=disposable-finished-goods-runtime hongmeng-release-smoke node \
  < scripts/seed-finished-goods-smoke.cjs > artifacts/finished-goods/release-fixture.json
FINISHED_GOODS_QA_ALLOW=disposable-finished-goods-runtime \
  FINISHED_GOODS_QA_FIXTURE=artifacts/finished-goods/release-fixture.json \
  FINISHED_GOODS_QA_OUTPUT=artifacts/finished-goods/release-http.json \
  node scripts/smoke-finished-goods.mjs
