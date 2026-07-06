import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionGroups: Record<string, string[]> = {
  upload: ['upload', 'upload_retry', 'upload_failed'],
  delete: ['delete'],
  download: ['download'],
  download_all: ['download_work_order_package'],
  create_work_order: ['create_work_order'],
  update_work_order: ['update_work_order', 'update_work_order_status', 'update_work_order_priority', 'update_work_order_planned_at'],
  delete_work_order: ['delete_work_order'],
  change_password: ['change_password'],
  update_resource_file: ['update_resource_file'],
  move_resource_file: ['move_resource_file'],
  restore: ['restore_work_order', 'restore_resource_file'],
  user: ['create_user', 'update_user', 'disable_user', 'reset_user_password'],
  export: ['export_work_orders', 'export_resource_files', 'export_operation_logs', 'export_metadata'],
  import: ['import_work_orders'],
  field: ['copy_work_order_link', 'copy_work_order_spec', 'print_work_order_qr', 'export_diagnostics'],
  connector: [
    'create_connector_parameter',
    'update_connector_parameter',
    'delete_connector_parameter',
    'restore_connector_parameter',
    'batch_update_connector_parameters',
    'batch_delete_connector_parameters',
    'copy_connector_parameter',
    'import_connector_parameters',
    'export_connector_parameters',
    'upload_connector_parameter_file',
    'delete_connector_parameter_file',
    'download_connector_parameter_file',
    'create_connector_parameter_import_batch',
    'rollback_connector_parameter_import_batch',
    'rollback_import_batch',
  ],
};

const writableActions = new Set(['copy_work_order_link', 'copy_work_order_spec', 'print_work_order_qr', 'copy_connector_parameter']);

function sanitize(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.slice(0, 5).map(sanitize) as Prisma.InputJsonArray;
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|key|database_url|session/i.test(key)) continue;
      out[key] = sanitize(item);
    }
    return out as Prisma.InputJsonObject;
  }
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  return value;
}

function detailSummary(value: unknown) {
  if (!value) return '';
  const text = JSON.stringify(sanitize(value));
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('limit') || 100) || 100, 100));
    const action = req.nextUrl.searchParams.get('action') || 'all';
    const actions = actionGroups[action];
    const logs = await prisma.operationLog.findMany({
      where: actions ? { action: { in: actions } } : undefined,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, displayName: true } } },
    });

    return NextResponse.json({
      logs: logs.map(log => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        user: log.user?.displayName || log.user?.username || '系统',
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        detailSummary: detailSummary(log.detail),
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '操作日志加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { action?: string; targetType?: string; targetId?: string; detail?: unknown };
    const action = String(body.action || '');
    if (!writableActions.has(action)) return NextResponse.json({ ok: false, error: '操作类型不允许' }, { status: 400 });
    await logOp({
      userId: user.id,
      action,
      targetType: typeof body.targetType === 'string' ? body.targetType.slice(0, 80) : null,
      targetId: typeof body.targetId === 'string' ? body.targetId.slice(0, 120) : null,
      detail: sanitize(body.detail),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '操作日志写入失败' }, { status: 500 });
  }
}
