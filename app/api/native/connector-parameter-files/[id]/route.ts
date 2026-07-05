import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const existing = await prisma.connectorParameterFile.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!existing) return nativeError('原始资料文件不存在', 404);
    const file = await prisma.connectorParameterFile.update({ where: { id: params.id }, data: { deletedAt: new Date() } });
    await logOp({ userId: user.id, action: 'delete_connector_parameter_file', targetType: 'connector_parameter_file', targetId: file.id, detail: { fileName: file.originalName, fileType: file.fileType, client: 'harmony_native' } });
    return nativeOk({ deleted: true });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('删除原始资料失败', 500);
  }
}
