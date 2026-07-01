#!/bin/sh
set -e

npx prisma migrate deploy
node prisma/seed.cjs
exec node .next/standalone/server.js
