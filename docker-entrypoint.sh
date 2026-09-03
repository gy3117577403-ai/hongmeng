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

case "${BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS:-60000}" in
  ''|*[!0-9]*)
    echo "BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS must be an integer between 1 and 2147483647"
    exit 1
    ;;
  *) maintenance_request_timeout_ms="${BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS:-60000}" ;;
esac
if [ "$maintenance_request_timeout_ms" -lt 1 ] || [ "$maintenance_request_timeout_ms" -gt 2147483647 ]; then
  echo "BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS must be an integer between 1 and 2147483647"
  exit 1
fi

# Cap retry growth while never making a configured normal poll interval shorter.
maintenance_max_backoff_seconds=300
if [ "$outbox_poll_seconds" -gt "$maintenance_max_backoff_seconds" ]; then
  maintenance_max_backoff_seconds="$outbox_poll_seconds"
fi

maintenance_log() {
  maintenance_log_level="$1"
  shift
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') component=background-maintenance level=${maintenance_log_level} $*" >&2
}

run_maintenance_step() {
  maintenance_step_name="$1"
  maintenance_step_path="$2"

  # This watchdog prevents the worker from waiting silently forever. It only
  # closes the localhost client and does not cancel the server-side handler.
  # The shared server-side single-flight gate therefore remains authoritative:
  # a still-running timed-out handler makes the next cycle fail fast with 409.
  MAINTENANCE_STEP_NAME="$maintenance_step_name" \
    MAINTENANCE_STEP_PATH="$maintenance_step_path" \
    BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS="$maintenance_request_timeout_ms" \
    node -e '
      const step = process.env.MAINTENANCE_STEP_NAME || "unknown";
      const path = process.env.MAINTENANCE_STEP_PATH || "/";
      const requestTimeoutMs = Number(process.env.BACKGROUND_MAINTENANCE_REQUEST_TIMEOUT_MS);
      const startedAt = Date.now();
      const fail = error => {
        const message = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : typeof error;
        const cause = error instanceof Error && error.cause instanceof Error
          ? ` cause=${JSON.stringify(error.cause.message)}`
          : "";
        console.error(`${new Date().toISOString()} component=background-maintenance level=error event=step_failed step=${JSON.stringify(step)} duration_ms=${Date.now() - startedAt} error_name=${JSON.stringify(errorName)} error=${JSON.stringify(message)}${cause}`);
        process.exitCode = 1;
      };
      fetch(`http://127.0.0.1:${process.env.PORT || "3000"}${path}`, {
        method: "POST",
        headers: { "x-outbox-worker-token": process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN },
        signal: AbortSignal.timeout(requestTimeoutMs),
      }).then(async response => {
        const text = await response.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch {}
        if (!response.ok || body?.ok !== true) {
          const code = body && typeof body.code === "string" ? body.code : "";
          const serverError = body && typeof body.error === "string" ? body.error.slice(0, 160) : "";
          const retryAfter = response.headers.get("retry-after") || "";
          throw new Error(`status=${response.status} code=${JSON.stringify(code)} retry_after=${JSON.stringify(retryAfter)} server_error=${JSON.stringify(serverError)}`);
        }
      }).catch(fail);
    '
}

HOSTNAME=0.0.0.0 node .next/standalone/server.js &
server_pid=$!

(
  maintenance_delay_seconds="$outbox_poll_seconds"
  maintenance_failure_streak=0
  maintenance_cycle=0
  maintenance_log info "event=worker_started poll_seconds=${outbox_poll_seconds} request_timeout_ms=${maintenance_request_timeout_ms} max_backoff_seconds=${maintenance_max_backoff_seconds} policy=single_flight_fail_fast"

  while kill -0 "$server_pid" 2>/dev/null; do
    sleep "$maintenance_delay_seconds"
    if ! kill -0 "$server_pid" 2>/dev/null; then
      break
    fi

    maintenance_cycle=$((maintenance_cycle + 1))
    maintenance_cycle_started_at="$(date +%s)"
    maintenance_failed_step=""

    # A cycle is strict single-flight and fail-fast: never start the next step
    # until the current handler responds, and stop the cycle on the first error
    # (including an endpoint's 409 already-running response).
    if ! run_maintenance_step \
      process_route_change_outbox \
      /api/internal/process-route-change-outbox; then
      maintenance_failed_step=process_route_change_outbox
    # Keep week transitions and historical repair work away from user-facing
    # GET requests. The endpoint uses non-blocking advisory locks, processes a
    # bounded batch, and rotates one auxiliary phase per poll. A failed cycle
    # is observable but never stops the HTTP server.
    elif ! run_maintenance_step \
      production_planning_maintenance \
      /api/internal/production-planning-maintenance; then
      maintenance_failed_step=production_planning_maintenance
    elif ! run_maintenance_step \
      daily_shipment_carryover \
      /api/internal/daily-shipment-maintenance; then
      maintenance_failed_step=daily_shipment_carryover
    elif ! run_maintenance_step \
      production_automatic_finalize \
      '/api/internal/production-planning-maintenance?phase=automatic_start_finalize&release=0&limit=2'; then
      maintenance_failed_step=production_automatic_finalize
    elif ! run_maintenance_step \
      quality_warning_projection \
      '/api/internal/production-planning-maintenance?phase=quality_warning_projection&release=0&limit=2'; then
      maintenance_failed_step=quality_warning_projection
    elif ! run_maintenance_step \
      quality_notification_outbox \
      /api/internal/quality-risk-outbox; then
      maintenance_failed_step=quality_notification_outbox
    fi

    maintenance_cycle_duration_seconds=$(($(date +%s) - maintenance_cycle_started_at))
    if [ -n "$maintenance_failed_step" ]; then
      maintenance_failure_streak=$((maintenance_failure_streak + 1))
      if [ "$maintenance_delay_seconds" -lt "$maintenance_max_backoff_seconds" ]; then
        if [ "$maintenance_delay_seconds" -gt $((maintenance_max_backoff_seconds / 2)) ]; then
          maintenance_delay_seconds="$maintenance_max_backoff_seconds"
        else
          maintenance_delay_seconds=$((maintenance_delay_seconds * 2))
        fi
      fi
      maintenance_log warn "event=cycle_failed cycle=${maintenance_cycle} failed_step=${maintenance_failed_step} duration_seconds=${maintenance_cycle_duration_seconds} failure_streak=${maintenance_failure_streak} next_delay_seconds=${maintenance_delay_seconds} http_server_process_running=true read_availability=unknown"
    else
      if [ "$maintenance_failure_streak" -gt 0 ]; then
        maintenance_log info "event=worker_recovered cycle=${maintenance_cycle} duration_seconds=${maintenance_cycle_duration_seconds} previous_failure_streak=${maintenance_failure_streak} next_delay_seconds=${outbox_poll_seconds}"
      else
        maintenance_log info "event=cycle_completed cycle=${maintenance_cycle} duration_seconds=${maintenance_cycle_duration_seconds} next_delay_seconds=${outbox_poll_seconds}"
      fi
      maintenance_failure_streak=0
      maintenance_delay_seconds="$outbox_poll_seconds"
    fi
  done
  maintenance_log info "event=worker_stopped reason=http_server_exited"
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
