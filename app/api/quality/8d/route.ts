import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prepareEightDPdf } from '@/lib/eight-d-pdf-upload';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import {
  createEightDReportRecord,
  loadEightDReports,
  parseEightDReportMetadata,
  serializeEightDReport,
} from '@/lib/eight-d-reports';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function actor(user: { id: string; displayName: string; username: string }) {
  return { id: user.id, name: user.displayName || user.username };
}

function formInput(form: FormData): Record<string, unknown> {
  return {
    reportNo: form.get('reportNo'),
    title: form.get('title'),
    reportDate: form.get('reportDate'),
    responsibleDepartment: form.get('responsibleDepartment'),
    keywords: form.get('keywords'),
    status: form.get('status'),
    productIds: form.get('productIds'),
    issueIds: form.get('issueIds'),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const result = await loadEightDReports({
      keyword: req.nextUrl.searchParams.get('keyword') || '',
      status: req.nextUrl.searchParams.get('status') || 'all',
      productId: req.nextUrl.searchParams.get('productId') || '',
      issueId: req.nextUrl.searchParams.get('issueId') || '',
      limit: Number(req.nextUrl.searchParams.get('limit') || 300),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return eightDRouteError(error, '8D档案加载失败');
  }
}

export async function POST(req: NextRequest) {
  let objectKey = '';
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择8D PDF文件' }, { status: 400 });
    const metadata = parseEightDReportMetadata(formInput(form));
    const reportId = crypto.randomUUID();
    const prepared = await prepareEightDPdf(upload, reportId, {
      displayName: typeof form.get('displayName') === 'string' ? String(form.get('displayName')) : null,
      note: typeof form.get('note') === 'string' ? String(form.get('note')) : null,
    });
    objectKey = prepared.file.objectKey;
    await putObject({
      key: objectKey,
      body: prepared.body,
      contentType: 'application/pdf',
      originalName: prepared.file.originalName,
    });
    const report = await prisma.$transaction(tx => createEightDReportRecord(tx, {
      id: reportId,
      metadata,
      file: prepared.file,
      actor: actor(user),
    }));
    await logOp({
      userId: user.id,
      action: 'create_eight_d_report',
      targetType: 'eight_d_report',
      targetId: report.id,
      detail: {
        reportNo: report.reportNo,
        versionNumber: 1,
        productCount: metadata.productIds.length,
        issueCount: metadata.issueIds.length,
        sha256: prepared.file.sha256,
      },
    });
    return NextResponse.json({ ok: true, report: serializeEightDReport(report) }, { status: 201 });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    return eightDRouteError(error, '8D PDF上传失败，请检查对象存储配置');
  }
}
