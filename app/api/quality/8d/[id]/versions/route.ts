import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { prepareEightDPdf } from '@/lib/eight-d-pdf-upload';
import { eightDRouteError } from '@/lib/eight-d-route-response';
import { addEightDReportVersionRecord, expectedEightDVersion, serializeEightDReport } from '@/lib/eight-d-reports';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { deleteObjectsBestEffort, putObject } from '@/lib/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let objectKey = '';
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireUser();
    const form = await req.formData();
    const upload = form.get('file');
    if (!(upload instanceof File)) return NextResponse.json({ ok: false, error: '请选择新的8D PDF文件' }, { status: 400 });
    const expectedVersion = expectedEightDVersion(form.get('expectedVersion'));
    const prepared = await prepareEightDPdf(upload, params.id, {
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
    const report = await prisma.$transaction(tx => addEightDReportVersionRecord(
      tx,
      params.id,
      prepared.file,
      expectedVersion,
      { id: user.id, name: user.displayName || user.username },
    ));
    await logOp({
      userId: user.id,
      action: 'upload_eight_d_report_version',
      targetType: 'eight_d_report',
      targetId: params.id,
      detail: { sha256: prepared.file.sha256, objectKey: prepared.file.objectKey, reportVersion: report.version },
    });
    return NextResponse.json({ ok: true, report: serializeEightDReport(report) }, { status: 201 });
  } catch (error) {
    if (objectKey) await deleteObjectsBestEffort([objectKey]);
    return eightDRouteError(error, '8D PDF新版本上传失败，请检查对象存储配置');
  }
}
