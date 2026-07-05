import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { connectorFileType, connectorObjectKey, serializeConnectorParameterFile, validateConnectorFile } from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { putObject } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const nativeDownloadBasePath = '/api/native/connector-parameter-files';

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return nativeError('请选择原始资料文件', 400);
    const err = validateConnectorFile(file.name, file.size);
    if (err) return nativeError(err, 400);
    const objectKey = connectorObjectKey(file.name, crypto.randomUUID());
    const mimeType = file.type || 'application/octet-stream';
    await putObject({ key: objectKey, body: Buffer.from(await file.arrayBuffer()), contentType: mimeType, originalName: file.name });
    const item = await prisma.connectorParameterFile.create({
      data: {
        originalName: file.name,
        mimeType,
        fileType: connectorFileType(file.name, mimeType),
        fileSize: file.size,
        objectKey,
        uploadedBy: user.displayName || user.username,
      },
    });
    await logOp({ userId: user.id, action: 'upload_connector_parameter_file', targetType: 'connector_parameter_file', targetId: item.id, detail: { fileName: item.originalName, fileSize: item.fileSize, fileType: item.fileType, client: 'harmony_native' } });
    return nativeOk({ file: serializeConnectorParameterFile(item, { downloadBasePath: nativeDownloadBasePath }) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('上传原始资料失败，请检查对象存储配置', 500);
  }
}
