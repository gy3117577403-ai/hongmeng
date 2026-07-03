import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { connectorParameterCsv } from '@/lib/connector-parameters';
import { csvResponse } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const items = await prisma.connectorParameter.findMany({
      where: { deletedAt: null },
      orderBy: [{ rowNo: 'asc' }, { createdAt: 'asc' }],
    });
    await logOp({
      userId: user.id,
      action: 'export_connector_parameters',
      targetType: 'connector_parameter',
      detail: { count: items.length },
    });
    return csvResponse('连接器参数资料.csv', connectorParameterCsv(items));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return Response.json({ ok: false, error: '导出连接器参数失败' }, { status: 500 });
  }
}
