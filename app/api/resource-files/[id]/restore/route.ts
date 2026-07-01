import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { serializeResourceFile } from '@/lib/resource-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const old = await prisma.resourceFile.findUnique({ where: { id: params.id } });
    if (!old) return NextResponse.json({ ok: false, error: '文件不存在' }, { status: 404 });
    const file = await prisma.resourceFile.update({
      where: { id: params.id },
      data: { deletedAt: null, status: 'uploaded' },
      include: {
        workOrder: { select: { code: true, productName: true } },
        category: { select: { name: true, code: true } },
        uploadedBy: { select: { displayName: true, username: true } },
      },
    });
    await logOp({ userId: user.id, action: 'restore_resource_file', targetType: 'resource_file', targetId: file.id, detail: { fileName: file.displayName || file.originalName } });
    return NextResponse.json({ ok: true, file: serializeResourceFile(file) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    return NextResponse.json({ ok: false, error: '恢复文件失败' }, { status: 500 });
  }
}
