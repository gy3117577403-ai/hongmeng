import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { putObject } from '@/lib/s3';
import { fileType, safeFilename, validateFile } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function versionMinor(version?: string | null) {
  const m = String(version || '').match(/^V1\.(\d+)$/i);
  return m ? Number(m[1]) : -1;
}

async function nextVersion(workOrderId: string, categoryId: string) {
  const files = await prisma.resourceFile.findMany({
    where: { workOrderId, categoryId },
    select: { version: true },
  });
  const max = files.reduce((n, f) => Math.max(n, versionMinor(f.version)), -1);
  return `V1.${max + 1}`;
}

function serializeFile(f: {
  id: string;
  workOrderId: string;
  categoryId: string;
  originalName: string;
  displayName: string | null;
  remark: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  version: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...f,
    version: f.version || 'V1.0',
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    contentUrl: `/api/resource-files/${f.id}/content`,
    viewUrl: `/api/resource-files/${f.id}/view`,
    downloadUrl: `/api/resource-files/${f.id}/download`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const workOrderId = String(form.get('workOrderId') || '');
    const categoryId = String(form.get('categoryId') || '');
    const up = form.get('file');

    if (!workOrderId) return NextResponse.json({ message: '未选择工单' }, { status: 400 });
    if (!categoryId) return NextResponse.json({ message: '未选择分类' }, { status: 400 });
    if (!(up instanceof File)) return NextResponse.json({ message: '请选择文件' }, { status: 400 });

    const err = validateFile(up.name, up.type, up.size);
    if (err) return NextResponse.json({ message: err }, { status: 400 });

    const [wo, cat] = await Promise.all([
      prisma.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null } }),
      prisma.resourceCategory.findUnique({ where: { id: categoryId } }),
    ]);
    if (!wo || !cat) return NextResponse.json({ message: '工单或分类不存在' }, { status: 404 });

    const ft = fileType(up.name, up.type);
    const version = await nextVersion(wo.id, cat.id);
    const key = `work-orders/${wo.code}/${cat.code}/${ymd(new Date())}/${crypto.randomUUID()}-${safeFilename(up.name)}`;
    await putObject({ key, body: Buffer.from(await up.arrayBuffer()), contentType: up.type || 'application/octet-stream', originalName: up.name });

    const f = await prisma.resourceFile.create({
      data: {
        workOrderId: wo.id,
        categoryId: cat.id,
        originalName: up.name,
        mimeType: up.type || 'application/octet-stream',
        fileType: ft,
        fileSize: up.size,
        objectKey: key,
        version,
        uploadedById: user.id,
      },
    });

    await logOp({
      userId: user.id,
      action: 'upload',
      targetType: 'resource_file',
      targetId: f.id,
      detail: { workOrderCode: wo.code, categoryCode: cat.code, version },
    });
    return NextResponse.json({ file: serializeFile(f) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ message: '上传失败，请检查对象存储配置' }, { status: 500 });
  }
}
