import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { signedUrl } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const file = await prisma.connectorParameterFile.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!file) return nativeError('原始资料文件不存在', 404);
    await logOp({ userId: user.id, action: 'download_connector_parameter_file', targetType: 'connector_parameter_file', targetId: file.id, detail: { fileName: file.originalName, fileType: file.fileType, client: 'harmony_native' } });
    return Response.redirect(await signedUrl({ key: file.objectKey, filename: file.displayName || file.originalName, disposition: 'attachment', contentType: file.mimeType }));
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('原始资料下载失败', 500);
  }
}
