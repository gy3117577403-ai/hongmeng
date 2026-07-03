import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { signedUrl } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const file = await prisma.connectorParameterFile.findFirst({ where: { id: params.id, deletedAt: null } });
    if (!file) return NextResponse.json({ ok: false, error: '原始资料文件不存在' }, { status: 404 });

    await logOp({
      userId: user.id,
      action: 'download_connector_parameter_file',
      targetType: 'connector_parameter_file',
      targetId: file.id,
      detail: { fileName: file.originalName, fileType: file.fileType },
    });

    return NextResponse.redirect(await signedUrl({
      key: file.objectKey,
      filename: file.displayName || file.originalName,
      disposition: 'attachment',
      contentType: file.mimeType,
    }));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '原始资料下载失败' }, { status: 500 });
  }
}
