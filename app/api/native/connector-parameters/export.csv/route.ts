import { connectorParameterCsv } from '@/lib/connector-parameters';
import { csvResponse } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireNativeUser(req);
    const items = await prisma.connectorParameter.findMany({ where: { deletedAt: null }, orderBy: [{ rowNo: 'asc' }, { createdAt: 'asc' }] });
    await logOp({ userId: user.id, action: 'export_connector_parameters', targetType: 'connector_parameter', detail: { count: items.length, client: 'harmony_native' } });
    return csvResponse('connector-parameters.csv', connectorParameterCsv(items));
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('导出连接器参数失败', 500);
  }
}
