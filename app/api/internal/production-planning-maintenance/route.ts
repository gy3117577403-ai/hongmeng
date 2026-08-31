import crypto, { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  isProductionPlanningAuxiliaryPhase,
  runProductionPlanningMaintenanceCycle,
} from '@/lib/production-planning-maintenance';

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
  const requestedPhase = req.nextUrl.searchParams.get('phase');
  if (requestedPhase && !isProductionPlanningAuxiliaryPhase(requestedPhase)) {
    return NextResponse.json({
      ok: false,
      error: 'unsupported maintenance phase',
      code: 'PRODUCTION_MAINTENANCE_PHASE_INVALID',
      requestId,
    }, { status: 400 });
  }
  const auxiliaryPhase = isProductionPlanningAuxiliaryPhase(requestedPhase) ? requestedPhase : undefined;
  const parsedLimit = Number(req.nextUrl.searchParams.get('limit'));
  const automaticReleaseLimit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 5)
    : 2;
  try {
    const result = await runProductionPlanningMaintenanceCycle({
      automaticReleaseLimit,
      includeAutomaticRelease: req.nextUrl.searchParams.get('release') !== '0',
      ...(auxiliaryPhase ? { auxiliaryPhase } : {}),
    });
    const log = result.ok ? console.info : console.warn;
    log('production planning maintenance cycle', JSON.stringify({ requestId, ...result }));
    const response = NextResponse.json({ ok: result.ok, requestId, result });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('production planning maintenance cycle failed', {
      requestId,
      code: 'PRODUCTION_PLANNING_MAINTENANCE_FAILED',
      error,
    });
    return NextResponse.json({
      ok: false,
      error: 'production planning maintenance failed',
      code: 'PRODUCTION_PLANNING_MAINTENANCE_FAILED',
      requestId,
    }, { status: 500 });
  }
}
