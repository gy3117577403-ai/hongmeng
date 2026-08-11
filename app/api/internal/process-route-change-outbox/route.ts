import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchProcessRouteChangeOutbox } from '@/lib/process-route-change-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const result = await dispatchProcessRouteChangeOutbox({ limit: 10 });
  return NextResponse.json({ ok: true, result });
}
