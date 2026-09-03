import crypto, { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { chinaDateKey } from '@/lib/china-date';
import {
  DailyShipmentServiceError,
  reconcileAllDailyShipmentCarryovers,
  reconcileDailyShipmentCutoverWindow,
} from '@/lib/daily-shipment-service';
import { backgroundMaintenanceGate } from '@/lib/maintenance-single-flight';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validWorkerToken(req: NextRequest): boolean {
  const expected = Buffer.from(process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '', 'utf8');
  const actual = Buffer.from(req.headers.get('x-outbox-worker-token') || '', 'utf8');
  if (expected.length < 32 || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export async function POST(req: NextRequest) {
  if (!validWorkerToken(req)) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  const requestId = randomUUID();
  try {
    const flight = await backgroundMaintenanceGate.run({
      requestId,
      phase: 'daily_shipment_carryover',
    }, async () => {
      const targetShipDate = chinaDateKey(new Date());
      const repair = await reconcileDailyShipmentCutoverWindow({
        startDate: '2026-09-01',
        endDate: targetShipDate,
        pageSize: 200,
      });
      const carryover = await reconcileAllDailyShipmentCarryovers({ targetShipDate, limit: 200 });
      return { repair, carryover };
    });
    if (!flight.started) {
      const response = NextResponse.json({
        ok: false,
        error: 'daily shipment maintenance already running',
        code: 'BACKGROUND_MAINTENANCE_ALREADY_RUNNING',
        requestId,
        active: flight.active,
        activeForMs: flight.activeForMs,
      }, { status: 409 });
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('Retry-After', '30');
      return response;
    }
    const result = flight.value;
    const log = result.repair.failed.length || result.carryover.blocked.length ? console.warn : console.info;
    log('daily shipment carryover maintenance', JSON.stringify({ requestId, ...result }));
    const response = NextResponse.json({ ok: true, requestId, result });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const code = error instanceof DailyShipmentServiceError ? error.code : 'DAILY_SHIPMENT_MAINTENANCE_FAILED';
    console.error('daily shipment carryover maintenance failed', { requestId, code, error });
    return NextResponse.json({
      ok: false,
      error: 'daily shipment maintenance failed',
      code,
      requestId,
    }, { status: 500 });
  }
}
