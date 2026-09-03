import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { backgroundMaintenanceGate } from '@/lib/maintenance-single-flight';
import { dispatchQualityNotifications } from '@/lib/quality-risk-notifications';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const expected = Buffer.from(process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '');
  const actual = Buffer.from(req.headers.get('x-outbox-worker-token') || '');
  if (expected.length < 32 || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return NextResponse.json({ ok: false }, { status: 404 });
  const requestId = crypto.randomUUID();
  const flight = await backgroundMaintenanceGate.run({
    requestId,
    phase: 'quality_notification_outbox',
  }, () => dispatchQualityNotifications());
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
  return NextResponse.json({ ok: true, requestId, result: flight.value });
}
