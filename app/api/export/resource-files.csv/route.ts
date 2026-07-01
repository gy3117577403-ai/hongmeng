import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csv, csvResponse, iso } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const files = await prisma.resourceFile.findMany({
      include: {
        workOrder: { select: { code: true } },
        category: { select: { name: true } },
        uploadedBy: { select: { username: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    await logOp({ userId: user.id, action: 'export_resource_files', targetType: 'export', detail: { count: files.length } });

    const rows = [
      ['工单号', '分类', '原始文件名', '显示名称', '版本', '文件类型', '文件大小', '上传人', '上传时间', '状态', '备注'],
      ...files.map(f => [
        f.workOrder.code,
        f.category.name,
        f.originalName,
        f.displayName || '',
        f.version || 'V1.0',
        f.fileType.toUpperCase(),
        f.fileSize,
        f.uploadedBy?.displayName || f.uploadedBy?.username || '',
        iso(f.createdAt),
        f.deletedAt ? '已删除' : f.status,
        f.remark || '',
      ]),
    ];

    return csvResponse('文件清单.csv', csv(rows));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '导出文件清单失败' }, { status: 500 });
  }
}
