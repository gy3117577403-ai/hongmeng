import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchProcessRouteChangeOutbox } from '@/lib/process-route-change-notifications';
import { recoverStaleSupplementRouteCompletions } from '@/lib/process-supplement-completion-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let recoveryCursor: string | null = null;

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
  const recovery = process.env.PROCESS_SUPPLEMENT_COMPLETION_RECOVERY_ENABLED === 'false'
    ? null
    : await recoverStaleSupplementRouteCompletions({ afterId: recoveryCursor, limit: 3 });
  if (recovery) recoveryCursor = recovery.nextCursor;
  if (recovery?.repairedRouteIds.length || recovery?.failures.length) {
    console.info('supplement route completion recovery', JSON.stringify(recovery));
  }
  const result = await dispatchProcessRouteChangeOutbox({ limit: 10 });
  return NextResponse.json({ ok: true, result, recovery });
}
