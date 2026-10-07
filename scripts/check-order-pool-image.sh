#!/usr/bin/env bash
set -euo pipefail
: "${ORDER_POOL_IMAGE:?Exact locally built release image required}"
: "${CI_MINIO_IMAGE:?Pinned object storage image required}"
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/hongmeng_order_pool_image_ci?schema=public'
export ORDER_POOL_QA_ALLOW=disposable-order-pool
export ORDER_POOL_QA_BASE=http://127.0.0.1:3410
export ORDER_POOL_QA_OUTPUT=artifacts/order-pool-image
export ORDER_POOL_QA_FIXTURE=/tmp/order-pool-image-fixture.json
export S3_ENDPOINT=http://127.0.0.1:19100
export S3_PUBLIC_ENDPOINT="$S3_ENDPOINT"
export S3_REGION=auto
export S3_BUCKET=workorder-resources
export S3_FORCE_PATH_STYLE=true
export S3_ACCESS_KEY_ID=orderpoolstorage
export S3_SECRET_ACCESS_KEY=order-pool-ci-storage-only-123456
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE hongmeng_order_pool_image_ci'
cleanup() {
  docker logs hongmeng-order-pool-image > order-pool-image-server.log 2>&1 || true
  docker rm -f hongmeng-order-pool-image hongmeng-order-pool-image-storage >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run -d --name hongmeng-order-pool-image-storage --network host \
  -e MINIO_ROOT_USER="$S3_ACCESS_KEY_ID" -e MINIO_ROOT_PASSWORD="$S3_SECRET_ACCESS_KEY" \
  "$CI_MINIO_IMAGE" server /data --address :19100
SMOKE_STORAGE_ALLOW=disposable-ci-storage node scripts/prepare-smoke-storage.mjs
docker run -d --name hongmeng-order-pool-image --network host \
  -e DATABASE_URL="$DATABASE_URL" -e DAILY_PLAN_ENABLED=true -e PORT=3410 -e APP_BASE_URL="$ORDER_POOL_QA_BASE" \
  -e SESSION_SECRET=order-pool-ci-image-session-1234567890 \
  -e SEED_ADMIN_USERNAME=orderpoolimage -e 'SEED_ADMIN_PASSWORD=Disposable-Pool-2026!A' \
  -e S3_ENDPOINT -e S3_PUBLIC_ENDPOINT -e S3_REGION -e S3_BUCKET -e S3_FORCE_PATH_STYLE \
  -e S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" "$ORDER_POOL_IMAGE"
ready=0
for attempt in $(seq 1 90); do
  if curl --fail --silent "$ORDER_POOL_QA_BASE/api/ready" >/dev/null; then ready=1; break; fi
  sleep 2
done
test "$ready" = 1
npx tsx scripts/seed-order-pool-smoke.ts > "$ORDER_POOL_QA_FIXTURE"
node scripts/smoke-order-pool-browser.mjs
