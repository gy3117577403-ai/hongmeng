import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  ProductionAccessScopeError,
  resolveProductionEntityScope,
} from '@/lib/production-access-scope';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { canManageWipWarehouse } from '@/lib/wip-access';
import { serializeWipApiValue } from '@/lib/wip-api-serialization';
import {
  enterWipWarehouse,
  listWipWarehouse,
  previewWipEntry,
  rescheduleWipAllocation,
  scheduleWipLot,
  WipWarehouseError,
} from '@/lib/wip-warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ProductionAccessScopeError || error instanceof WipWarehouseError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error('wip warehouse request failed', error);
  return NextResponse.json(
    { ok: false, error: '半成品仓操作失败，请刷新后重试', code: 'WIP_REQUEST_FAILED' },
    { status: 500 },
  );
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const resolvedScope = resolveProductionEntityScope(user);
    const productionScope = {
      ...resolvedScope,
      canWrite: resolvedScope.canWrite && canManageWipWarehouse(user),
      readOnly: !resolvedScope.canWrite || !canManageWipWarehouse(user),
    };
    const data = await listWipWarehouse({
      keyword: req.nextUrl.searchParams.get('keyword'),
      batchId: req.nextUrl.searchParams.get('batchId'),
      productionScope,
    });
    const response = NextResponse.json({ ok: true, data });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const resolvedScope = resolveProductionEntityScope(user);
    const canManage = canManageWipWarehouse(user);
    const productionScope = {
      ...resolvedScope,
      canWrite: resolvedScope.canWrite && canManage,
      readOnly: !resolvedScope.canWrite || !canManage,
    };
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '').trim();
    const actorName = user.displayName || user.username;
    const common = { actorId: user.id, actorName, productionScope };
    if (action === 'preview_entry') {
      const data = await previewWipEntry({
        batchId: body.batchId,
        quantity: body.quantity,
        productionScope,
      });
      return NextResponse.json({ ok: true, data: serializeWipApiValue(data) });
    }
    if (action === 'enter') {
      const data = await enterWipWarehouse({
        ...common,
        batchId: body.batchId,
        quantity: body.quantity,
        reasonCode: body.reasonCode,
        reason: body.reason,
        locationCode: body.locationCode,
        containerCode: body.containerCode,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, data: serializeWipApiValue(data) });
    }
    if (action === 'schedule') {
      const data = await scheduleWipLot({
        ...common,
        lotId: body.lotId,
        quantity: body.quantity,
        targetWeekStartDate: body.targetWeekStartDate,
        teamId: body.teamId,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, data: serializeWipApiValue(data) });
    }
    if (action === 'reschedule') {
      const data = await rescheduleWipAllocation({
        ...common,
        allocationId: body.allocationId,
        targetWeekStartDate: body.targetWeekStartDate,
        teamId: body.teamId,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
      });
      return NextResponse.json({ ok: true, data: serializeWipApiValue(data) });
    }
    throw new WipWarehouseError('不支持的半成品仓操作', 'WIP_ACTION_INVALID');
  } catch (error) {
    return errorResponse(error);
  }
}
