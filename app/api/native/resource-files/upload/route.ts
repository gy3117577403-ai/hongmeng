import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeFileDto, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
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
  const files = await prisma.resourceFile.findMany({ where: { workOrderId, categoryId }, select: { version: true } });
  const max = files.reduce((n, file) => Math.max(n, versionMinor(file.version)), -1);
  return `V1.${max + 1}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireNativeUser(req);
    const form = await req.formData();
    const workOrderId = String(form.get('workOrderId') || '');
    const categoryId = String(form.get('categoryId') || '');
    const up = form.get('file');

    if (!workOrderId) return nativeError('未选择工单', 400);
    if (!categoryId) return nativeError('未选择分类', 400);
    if (!(up instanceof File)) return nativeError('请选择文件', 400);

    const err = validateFile(up.name, up.type, up.size);
    if (err) {
      await logOp({ userId: user.id, action: 'upload_failed', targetType: 'resource_file', detail: { client: 'harmony_native', reason: 'invalid_file', fileName: up.name, fileSize: up.size } });
      return nativeError(err, 400);
    }

    const [workOrder, category] = await Promise.all([
      prisma.workOrder.findFirst({ where: { id: workOrderId, deletedAt: null } }),
      prisma.resourceCategory.findUnique({ where: { id: categoryId } }),
    ]);
    if (!workOrder || !category) return nativeError('工单或分类不存在', 404);

    const version = await nextVersion(workOrder.id, category.id);
    const objectKey = `work-orders/${workOrder.code}/${category.code}/${ymd(new Date())}/${crypto.randomUUID()}-${safeFilename(up.name)}`;
    await putObject({ key: objectKey, body: Buffer.from(await up.arrayBuffer()), contentType: up.type || 'application/octet-stream', originalName: up.name });

    const file = await prisma.resourceFile.create({
      data: {
        workOrderId: workOrder.id,
        categoryId: category.id,
        originalName: up.name,
        mimeType: up.type || 'application/octet-stream',
        fileType: fileType(up.name, up.type),
        fileSize: up.size,
        objectKey,
        version,
        uploadedById: user.id,
      },
      include: {
        uploadedBy: { select: { displayName: true, username: true } },
        category: { select: { name: true, code: true } },
      },
    });

    await logOp({
      userId: user.id,
      action: 'upload',
      targetType: 'resource_file',
      targetId: file.id,
      detail: { client: 'harmony_native', fileName: up.name, fileSize: up.size, workOrderCode: workOrder.code, categoryCode: category.code, version },
    });
    return nativeOk({ file: nativeFileDto(file) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('上传失败，请检查对象存储配置', 500);
  }
}
