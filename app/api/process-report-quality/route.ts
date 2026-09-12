import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, ForbiddenError } from '@/lib/auth';
import { canAccessApiRoute } from '@/lib/api-route-access';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { qualityError } from '@/lib/quality-data-http';
import { QualityDataError } from '@/lib/quality-data';
import { qualityFileType, QUALITY_FILE_MAX } from '@/lib/quality-data-files';
import { readQualityImageGeometry } from '@/lib/quality-image-metadata';
import { processQualityType } from '@/lib/process-quality-report';
import { safeFilename } from '@/lib/validation';
import { putObject, getObjectStream, deleteObjectsBestEffort } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
async function reporter(write = false) {
  const user = await requireUser(write ? { write: 'labor' } : undefined);
  if (!canAccessApiRoute(user.access, '/api/field-report/tickets/quality/completions', 'POST') &&
    !canAccessApiRoute(user.access, '/api/process-management/routes/quality/completions', 'POST') &&
    !canAccessApiRoute(user.access, '/api/quality-data/records', 'GET')) throw new ForbiddenError();
  return user;
}
export async function GET(req: NextRequest) {
  try {
    const user = await reporter();
    if (req.nextUrl.searchParams.get('employees') === '1') {
      const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80);
      const data = await prisma.employee.findMany({ where: { isActive: true, ...(q ? { OR: [{ name: { contains: q } }, { employeeNo: { contains: q } }] } : {}) },
        select: { id: true, name: true, employeeNo: true }, orderBy: { employeeNo: 'asc' }, take: 500 });
      return NextResponse.json({ ok: true, data }, { headers });
    }
    const file = await prisma.processQualityEvidence.findFirst({ where: { id: req.nextUrl.searchParams.get('id') || '', createdById: user.id, deletedAt: null } });
    if (!file) throw new QualityDataError('照片不存在', 404);
    return new Response(Readable.toWeb(await getObjectStream(file.objectKey)) as ReadableStream, { headers: { ...headers, 'Content-Type': file.mimeType,
      'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(file.originalName) } });
  } catch (e) { return qualityError(e); }
}
export async function POST(req: NextRequest) {
  let objectKey = '', saved = false;
  try {
    assertSameOriginMutationRequest(req);
    const user = await reporter(true);
    if (!canAccessApiRoute(user.access, '/api/field-report/tickets/quality/completions', 'POST') &&
      !canAccessApiRoute(user.access, '/api/process-management/routes/quality/completions', 'POST')) throw new ForbiddenError();
    if (Number(req.headers.get('content-length') || 0) > QUALITY_FILE_MAX + 16384) throw new QualityDataError('照片不能超过 20 MB', 413);
    const form = await req.formData(), file = form.get('file');
    const routeId = String(form.get('routeId') || ''), stepId = String(form.get('stepId') || ''), idempotencyKey = String(form.get('idempotencyKey') || '');
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw new QualityDataError('上传标识无效');
    if (!(file instanceof File) || file.size > QUALITY_FILE_MAX) throw new QualityDataError('请选择 20 MB 以内的照片');
    const step = await prisma.workOrderProcessStep.findFirst({ where: { id: stepId, routeId, retiredAt: null, route: { workOrder: { deletedAt: null } } } });
    if (!step || !processQualityType(step.processName)) throw new QualityDataError('请先选择压检、导通或检验工序');
    const bytes = Buffer.from(await file.arrayBuffer()), mimeType = qualityFileType(file.name, file.size, bytes);
    if (!mimeType.startsWith('image/')) throw new QualityDataError('报工质量附件仅支持照片');
    await readQualityImageGeometry(bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await prisma.processQualityEvidence.findUnique({ where: { createdById_idempotencyKey: { createdById: user.id, idempotencyKey } } });
    if (existing) {
      if (existing.sha256 !== sha256 || existing.routeId !== routeId || existing.stepId !== stepId || existing.deletedAt) throw new QualityDataError('上传内容已变化，请重新选择照片', 409);
      return NextResponse.json({ ok: true, data: { id: existing.id, name: existing.originalName } }, { headers });
    }
    objectKey = `process-quality/${user.id}/${randomUUID()}-${safeFilename(file.name)}`;
    await putObject({ key: objectKey, body: bytes, contentType: mimeType, originalName: file.name });
    const record = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quality-upload:' + user.id}))`;
      if (await tx.processQualityEvidence.count({ where: { createdById: user.id, recordId: null, deletedAt: null } }) >= 120) throw new QualityDataError('未提交照片已达 120 张，请先提交或移除未使用照片');
      return tx.processQualityEvidence.create({ data: { routeId, stepId, createdById: user.id, idempotencyKey, originalName: file.name.slice(0, 240), mimeType, size: bytes.length, sha256, objectKey } });
    });
    saved = true;
    return NextResponse.json({ ok: true, data: { id: record.id, name: record.originalName } }, { headers });
  } catch (e) { return qualityError(e); }
  finally { if (objectKey && !saved) await deleteObjectsBestEffort([objectKey]); }
}
export async function DELETE(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await reporter(true), id = req.nextUrl.searchParams.get('id') || '';
    const changed = await prisma.processQualityEvidence.updateMany({ where: { id, createdById: user.id, recordId: null, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!changed.count) throw new QualityDataError('照片已归档或已移除', 409);
    return NextResponse.json({ ok: true }, { headers });
  } catch (e) { return qualityError(e); }
}
