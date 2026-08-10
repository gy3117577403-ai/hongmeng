import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import { chinaWeekRange } from '@/lib/production-planning';
import {
  includeOlderProductionCarryovers,
  listOlderProductionCarryoverCandidates,
  ProductionCarryoverError,
  reconcileCurrentProductionCarryovers,
} from '@/lib/production-carryovers';
import { parseWeek } from '@/lib/weekly-work-orders';
import {
  assertProductionScopeRead,
  assertProductionScopeWrite,
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentWeekKey() {
  return chinaDateKey(chinaWeekRange(new Date()).start);
}

function requestedCurrentWeek(value: unknown) {
  const parsed = parseWeek(String(value || '').trim());
  const requested = parsed ? chinaDateKey(parsed) : currentWeekKey();
  if (requested !== currentWeekKey()) {
    throw new ProductionCarryoverError('更早遗留只能加入当前生产周', 'CARRYOVER_TARGET_NOT_CURRENT', 409);
  }
  return requested;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeRead(productionScope);
    const targetWeekStart = requestedCurrentWeek(req.nextUrl.searchParams.get('targetWeekStart'));
    if (productionScope.canReconcile) {
      await reconcileCurrentProductionCarryovers({ targetWeekStart, actorId: user.id });
    }
    const data = await listOlderProductionCarryoverCandidates({
      targetWeekStart,
      keyword: req.nextUrl.searchParams.get('keyword') || '',
      limit: Number(req.nextUrl.searchParams.get('limit')) || 500,
      productionScope,
    });
    const response = NextResponse.json({ ok: true, data });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ProductionCarryoverError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : '更早遗留加载失败';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const productionScope = resolveProductionEntityScope(user);
    assertProductionScopeWrite(productionScope);
    const body = await req.json();
    const targetWeekStart = requestedCurrentWeek(body.targetWeekStart);
    const data = await includeOlderProductionCarryovers({
      targetWeekStart,
      batchIds: Array.isArray(body.batchIds) ? body.batchIds : [],
      actorId: user.id,
      reason: body.reason,
      productionScope,
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof ProductionAccessScopeError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ProductionCarryoverError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : '加入更早遗留失败';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
