import { NextRequest, NextResponse } from 'next/server';
import {
  ForbiddenError,
  forbidden,
  requireCapability,
  UnauthorizedError,
  unauthorized,
} from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import {
  canMutateDailyShipment,
  dailyShipmentRequiredAction,
} from '@/lib/critical-operation-access';
import {
  addDailyShipmentItems,
  cancelDailyShipmentItem,
  closeDailyShipmentPlan,
  confirmDailyShipmentPlan,
  DailyShipmentServiceError,
  loadDailyShipmentWorkbench,
  recordDailyShipment,
  rollOverDailyShipmentPlan,
  reverseDailyShipment,
  updateDailyShipmentItem,
} from '@/lib/daily-shipment-service';
import { canRunGetReconciliation } from '@/lib/get-reconciliation-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DailyShipmentServiceError('请求数据格式不正确', 'SHIPMENT_REQUEST_INVALID');
  }
  return value as Record<string, unknown>;
}

function requestKey(request: NextRequest, body: Record<string, unknown>): unknown {
  return request.headers.get('idempotency-key') || body.idempotencyKey;
}

function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof UnauthorizedError) return unauthorized();
  if (error instanceof ForbiddenError) return forbidden('仅计划部或管理员可以执行该出货计划操作');
  if (error instanceof DailyShipmentServiceError) {
    return NextResponse.json({
      ok: false,
      error: error.message,
      message: error.message,
      code: error.code,
    }, { status: error.status });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({
      ok: false,
      error: '请求数据不是有效的 JSON',
      message: '请求数据不是有效的 JSON',
      code: 'SHIPMENT_REQUEST_INVALID',
    }, { status: 400 });
  }
  console.error(`[daily-shipments] ${context}`, error);
  return NextResponse.json({
    ok: false,
    error: '日出货计划处理失败，请稍后重试',
    message: '日出货计划处理失败，请稍后重试',
    code: 'SHIPMENT_INTERNAL_ERROR',
  }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireCapability('PLANNING', 'READ');
    const shipDate = request.nextUrl.searchParams.get('date') || chinaDateKey(new Date());
    const data = await loadDailyShipmentWorkbench({
      shipDate,
      ...(canRunGetReconciliation(user.access, ['PLANNING'])
        ? { actorUserId: user.id }
        : {}),
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error, 'load workbench');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireCapability('PLANNING', 'READ');
    const body = asRecord(await request.json());
    const action = String(body.action || '').trim();
    if (!dailyShipmentRequiredAction(action)) {
      throw new DailyShipmentServiceError('不支持的日出货计划操作', 'SHIPMENT_ACTION_INVALID');
    }
    if (!canMutateDailyShipment(user.access, action)) throw new ForbiddenError();
    const idempotencyKey = requestKey(request, body);
    let result;
    switch (action) {
      case 'ADD_ITEMS': {
        const items = Array.isArray(body.items) ? body.items.map(asRecord) : [];
        result = await addDailyShipmentItems({
          actorUserId: user.id,
          shipDate: body.shipDate,
          idempotencyKey,
          items: items.map(item => ({
            productionPlanBatchId: item.productionPlanBatchId,
            plannedQuantity: item.plannedQuantity,
            plannedShipAt: item.plannedShipAt,
            shipmentPriority: item.shipmentPriority,
            note: item.note,
          })),
        });
        break;
      }
      case 'UPDATE_ITEM':
        result = await updateDailyShipmentItem({
          actorUserId: user.id,
          itemId: body.itemId,
          itemVersion: body.itemVersion,
          idempotencyKey,
          plannedQuantity: body.plannedQuantity,
          plannedShipAt: body.plannedShipAt,
          shipmentPriority: body.shipmentPriority,
          note: body.note,
        });
        break;
      case 'CANCEL_ITEM':
        result = await cancelDailyShipmentItem({
          actorUserId: user.id,
          itemId: body.itemId,
          itemVersion: body.itemVersion,
          idempotencyKey,
          reason: body.reason,
        });
        break;
      case 'CONFIRM_PLAN':
        result = await confirmDailyShipmentPlan({
          actorUserId: user.id,
          planId: body.planId,
          planVersion: body.planVersion,
          idempotencyKey,
        });
        break;
      case 'CLOSE_PLAN':
        result = await closeDailyShipmentPlan({
          actorUserId: user.id,
          planId: body.planId,
          planVersion: body.planVersion,
          idempotencyKey,
        });
        break;
      case 'ROLL_OVER_PLAN':
        result = await rollOverDailyShipmentPlan({
          actorUserId: user.id,
          planId: body.planId,
          planVersion: body.planVersion,
        });
        break;
      case 'RECORD_SHIPMENT':
        result = await recordDailyShipment({
          actorUserId: user.id,
          itemId: body.itemId,
          itemVersion: body.itemVersion,
          idempotencyKey,
          quantity: body.quantity,
          shippedAt: body.shippedAt,
          note: body.note,
        });
        break;
      case 'REVERSE_SHIPMENT':
        result = await reverseDailyShipment({
          actorUserId: user.id,
          eventId: body.eventId,
          itemVersion: body.itemVersion,
          idempotencyKey,
          quantity: body.quantity,
          reversedAt: body.reversedAt,
          reason: body.reason,
        });
        break;
      default:
        throw new DailyShipmentServiceError('不支持的日出货计划操作', 'SHIPMENT_ACTION_INVALID');
    }
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    return errorResponse(error, 'mutate workbench');
  }
}
