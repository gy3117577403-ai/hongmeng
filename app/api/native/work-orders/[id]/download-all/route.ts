import { Readable } from 'stream';
import yazl from 'yazl';
import { safeDisplayFilename } from '@/lib/filenames';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeZipName(value: string) {
  return value.normalize('NFKC').replace(/[\\/:*?"<>|#%{}^~`\[\]]/g, '_').replace(/\s+/g, '_').slice(0, 140) || 'file';
}

function uniquePath(base: string, used: Set<string>) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = base.lastIndexOf('.');
  const name = dot > -1 ? base.slice(0, dot) : base;
  const ext = dot > -1 ? base.slice(dot) : '';
  let index = 2;
  while (used.has(`${name}-${index}${ext}`)) index += 1;
  const next = `${name}-${index}${ext}`;
  used.add(next);
  return next;
}

function versionedName(name: string, version: string | null) {
  const safe = safeZipName(name);
  const v = safeZipName(version || 'V1.0');
  const dot = safe.lastIndexOf('.');
  if (dot <= 0) return `${safe}-${v}`;
  return `${safe.slice(0, dot)}-${v}${safe.slice(dot)}`;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireNativeUser(req);
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: params.id, deletedAt: null },
      include: {
        resourceFiles: {
          where: { deletedAt: null, status: 'uploaded' },
          include: { category: { select: { name: true, sortOrder: true } } },
          orderBy: [{ category: { sortOrder: 'asc' } }, { createdAt: 'asc' }],
        },
      },
    });
    if (!workOrder) return nativeError('工单不存在', 404);
    if (workOrder.resourceFiles.length === 0) return nativeError('当前工单暂无可下载文件', 400);

    const zip = new yazl.ZipFile();
    const used = new Set<string>();
    for (const file of workOrder.resourceFiles) {
      const folder = safeZipName(file.category.name);
      const filename = versionedName(safeDisplayFilename(file), file.version);
      zip.addReadStream(await getObjectStream(file.objectKey), uniquePath(`${folder}/${filename}`, used), { mtime: file.createdAt });
    }
    zip.end();

    await logOp({ userId: user.id, action: 'download_work_order_package', targetType: 'work_order', targetId: workOrder.id, detail: { code: workOrder.code, fileCount: workOrder.resourceFiles.length, client: 'harmony_native' } });

    const filename = `${workOrder.code}-资料包.zip`;
    const body = Readable.toWeb(zip.outputStream as unknown as Readable) as unknown as BodyInit;
    return new Response(body, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('下载全部失败', 500);
  }
}
