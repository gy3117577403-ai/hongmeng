import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csv, csvResponse, detailSummary, iso } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionText: Record<string, string> = {
  login: '登录',
  logout: '退出登录',
  upload: '上传文件',
  delete: '软删除文件',
  change_password: '修改密码',
  create_work_order: '新建工单',
  update_work_order: '编辑工单',
  update_work_order_status: '修改工单状态',
  update_work_order_priority: '修改优先级',
  update_work_order_planned_at: '修改计划时间',
  delete_work_order: '删除工单',
  download: '下载文件',
  download_work_order_package: '下载资料包',
  update_resource_file: '编辑文件信息',
  export_work_orders: '导出工单',
  export_resource_files: '导出文件清单',
  export_operation_logs: '导出操作日志',
  export_metadata: '导出元数据',
  import_work_orders: '导入工单',
};

export async function GET() {
  try {
    const user = await requireUser();
    const logs = await prisma.operationLog.findMany({
      take: 1000,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { username: true, displayName: true } } },
    });
    await logOp({ userId: user.id, action: 'export_operation_logs', targetType: 'export', detail: { count: logs.length } });

    const rows = [
      ['时间', '用户', '操作', '目标类型', '目标 ID', '详情摘要'],
      ...logs.map(item => [
        iso(item.createdAt),
        item.user?.displayName || item.user?.username || '系统',
        actionText[item.action] || item.action,
        item.targetType || '',
        item.targetId || '',
        detailSummary(item.detail),
      ]),
    ];

    return csvResponse('操作日志.csv', csv(rows));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '导出操作日志失败' }, { status: 500 });
  }
}
