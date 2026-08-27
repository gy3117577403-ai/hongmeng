#!/bin/sh
set -e

# Reject malformed public origins before migrations or the HTTP server start.
# A value such as http://https://host is technically parseable by URL(), but
# points to the wrong host/path and causes intermittent redirects and callbacks.
node scripts/validate-runtime-env.mjs

db_tries=1
until node -e "const net=require('net'); const url=new URL(process.env.DATABASE_URL); const socket=net.connect({host:url.hostname,port:Number(url.port||5432)},()=>{socket.end();process.exit(0)}); socket.setTimeout(1000,()=>{socket.destroy();process.exit(1)}); socket.on('error',()=>process.exit(1));"; do
  if [ "$db_tries" -ge 30 ]; then
    echo "database port was not ready after retries"
    exit 1
  fi
  echo "database port not ready, waiting ($db_tries/30)"
  db_tries=$((db_tries + 1))
  sleep 2
done

tries=1
until node node_modules/prisma/build/index.js migrate deploy; do
  if [ "$tries" -ge 30 ]; then
    echo "migration deploy failed after retries"
    exit 1
  fi
  echo "database not ready, retrying migration ($tries/30)"
  tries=$((tries + 1))
  sleep 2
done

node prisma/seed.cjs

# Use a per-container secret for the localhost-only durable notification pump.
# The token is never logged or exposed to browsers.
if [ -z "${PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN:-}" ]; then
  PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN="$(openssl rand -hex 32)"
  export PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN
fi
if [ "${#PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN}" -lt 32 ]; then
  echo "PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN must contain at least 32 characters"
  exit 1
fi

case "${PROCESS_ROUTE_CHANGE_OUTBOX_POLL_SECONDS:-30}" in
  ''|*[!0-9]*)
    echo "PROCESS_ROUTE_CHANGE_OUTBOX_POLL_SECONDS must be a positive integer"
    exit 1
    ;;
  *) outbox_poll_seconds="${PROCESS_ROUTE_CHANGE_OUTBOX_POLL_SECONDS:-30}" ;;
esac
if [ "$outbox_poll_seconds" -lt 1 ]; then
  echo "PROCESS_ROUTE_CHANGE_OUTBOX_POLL_SECONDS must be a positive integer"
  exit 1
fi

HOSTNAME=0.0.0.0 node .next/standalone/server.js &
server_pid=$!

(
  while kill -0 "$server_pid" 2>/dev/null; do
    sleep "$outbox_poll_seconds"
    if ! node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/internal/process-route-change-outbox', {method:'POST',headers:{'x-outbox-worker-token':process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN},signal:AbortSignal.timeout(10000)}).then(async response=>{if(!response.ok){throw new Error('HTTP '+response.status+' '+(await response.text()).slice(0,200))}}).catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exit(1)})"; then
      echo "process route change outbox poll failed; it will retry after ${outbox_poll_seconds}s" >&2
    fi
    if ! node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/internal/quality-risk-outbox', {method:'POST',headers:{'x-outbox-worker-token':process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN},signal:AbortSignal.timeout(10000)}).then(response=>{if(!response.ok)throw new Error('HTTP '+response.status)}).catch(()=>{console.error('quality notification poll failed');process.exit(1)})"; then
      echo "quality notification outbox will retry on next poll" >&2
    fi
  done
) &
worker_pid=$!

shutdown() {
  trap - INT TERM
  kill "$server_pid" "$worker_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
  exit 0
}
trap shutdown INT TERM

server_status=0
wait "$server_pid" || server_status=$?
kill "$worker_pid" 2>/dev/null || true
wait "$worker_pid" 2>/dev/null || true
exit "$server_status"
