import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { serializeConnectorParameterFile } from '@/lib/connector-parameters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const nativeDownloadBasePath = '/api/native/connector-parameter-files';

export async function GET(req: Request) {
  try {
    await requireNativeUser(req);
    const files = await prisma.connectorParameterFile.findMany({ where: { deletedAt: null }, orderBy: [{ createdAt: 'desc' }] });
    return nativeOk({ files: files.map(file => serializeConnectorParameterFile(file, { downloadBasePath: nativeDownloadBasePath })) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('原始资料附件加载失败', 500);
  }
}
