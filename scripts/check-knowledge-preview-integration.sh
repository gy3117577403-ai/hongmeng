#!/bin/sh
set -eu
test "${OFFICE_QA_ALLOW:-}" = disposable-office-runtime
PGPASSWORD=postgres createdb -h 127.0.0.1 -U postgres hongmeng_office_ci
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/hongmeng_office_ci?schema=public'
npx prisma migrate deploy
npm run preview:worker
RUN_OFFICE_INTEGRATION=1 npx tsx --test tests/knowledge-preview-integration.test.ts
