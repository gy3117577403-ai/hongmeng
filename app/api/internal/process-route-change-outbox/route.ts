import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { backgroundMaintenanceGate } from '@/lib/maintenance-single-flight';
import { dispatchProcessRouteChangeOutbox } from '@/lib/process-route-change-notifications';
import { recoverStaleSupplementRouteCompletions } from '@/lib/process-supplement-completion-recovery';
import { recoverStalePendingCompletionCoverage } from '@/lib/process-pending-coverage-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let recoveryCursor: string | null = null;
let coverageCursor: string | null = null;

function validWorkerToken(req: NextRequest): boolean {
  const expected = String(process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '');
  const actual = String(req.headers.get('x-outbox-worker-token') || '');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  if (expectedBuffer.length < 32 || actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(req: NextRequest) {
  if (!validWorkerToken(req)) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  const requestId = crypto.randomUUID();
  const flight = await backgroundMaintenanceGate.run({
    requestId,
    phase: 'process_route_change_outbox',
  }, async () => {
    const recovery = process.env.PROCESS_SUPPLEMENT_COMPLETION_RECOVERY_ENABLED === 'false'
      ? null
      : await recoverStaleSupplementRouteCompletions({ afterId: recoveryCursor, limit: 3 });
    if (recovery) recoveryCursor = recovery.nextCursor;
    if (recovery?.repairedRouteIds.length || recovery?.failures.length) {
      console.info('supplement route completion recovery', JSON.stringify(recovery));
    }
    const result = await dispatchProcessRouteChangeOutbox({ limit: 10 });
    const coverageRecovery = process.env.PROCESS_PENDING_COVERAGE_RECOVERY_ENABLED === 'false' ? null
      : await recoverStalePendingCompletionCoverage({ afterId: coverageCursor, limit: 3 });
    if (coverageRecovery) coverageCursor = coverageRecovery.nextCursor;
    if (coverageRecovery?.repairedRouteIds.length || coverageRecovery?.failures.length) console.info('pending completion coverage recovery', JSON.stringify(coverageRecovery));
    return { result, recovery, coverageRecovery };
  });
  if (!flight.started) {
    const response = NextResponse.json({
      ok: false,
      error: 'background maintenance already running',
      code: 'BACKGROUND_MAINTENANCE_ALREADY_RUNNING',
      requestId,
      active: flight.active,
      activeForMs: flight.activeForMs,
    }, { status: 409 });
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Retry-After', '30');
    return response;
  }
  return NextResponse.json({ ok: true, requestId, ...flight.value });
}
