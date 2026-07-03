import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  connectorFileType,
  connectorObjectKey,
  serializeConnectorParameterFile,
  validateConnectorFile,
} from '@/lib/connector-parameters';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { putObject } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: '请选择原始资料文件' }, { status: 400 });
    const err = validateConnectorFile(file.name, file.size);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });

    const objectKey = connectorObjectKey(file.name, crypto.randomUUID());
    const mimeType = file.type || 'application/octet-stream';
    await putObject({
      key: objectKey,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: mimeType,
      originalName: file.name,
    });

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

    await logOp({
      userId: user.id,
      action: 'upload_connector_parameter_file',
      targetType: 'connector_parameter_file',
      targetId: item.id,
      detail: { fileName: item.originalName, fileSize: item.fileSize, fileType: item.fileType },
    });

    return NextResponse.json({ ok: true, file: serializeConnectorParameterFile(item) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '上传原始资料失败，请检查对象存储配置' }, { status: 500 });
  }
}
