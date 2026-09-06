import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import {
  createInternalQualityRiskRecord,
  InternalQualityRiskError,
  internalQualityRiskInclude,
  loadInternalQualityRisks,
  parseInternalQualityRiskInput,
  serializeInternalQualityRisk,
  transitionInternalQualityRiskWorkflow,
} from '@/lib/internal-quality-risks';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { qualityRiskActor } from '@/lib/quality-risk-access';
import { actOnQualityWorkflow } from '@/lib/quality-workflow-v3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function actor(user: { id: string; displayName: string; username: string }) {
  return { id: user.id, name: user.displayName || user.username };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const result = await loadInternalQualityRisks({
      viewerId: user.id,
      workView: req.nextUrl.searchParams.get('view') || 'ALL',
      ownerId: req.nextUrl.searchParams.get('ownerId') || '',
      dateFrom: req.nextUrl.searchParams.get('dateFrom') || '',
      dateTo: req.nextUrl.searchParams.get('dateTo') || '',
      overdue: req.nextUrl.searchParams.get('overdue') === 'true',
      offset: Number(req.nextUrl.searchParams.get('offset') || 0),
      keyword: req.nextUrl.searchParams.get('keyword') || '',
      status: req.nextUrl.searchParams.get('status') || 'all',
      severity: req.nextUrl.searchParams.get('severity') || '',
      problemCategory: req.nextUrl.searchParams.get('problemCategory') || '',
      department: req.nextUrl.searchParams.get('department') || '',
      productId: req.nextUrl.searchParams.get('productId') || '',
      issueId: req.nextUrl.searchParams.get('issueId') || '',
      workOrderId: req.nextUrl.searchParams.get('workOrderId') || '',
      limit: Number(req.nextUrl.searchParams.get('limit') || 300),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常加载失败');
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutationRequest(req);
    const user = await requireCapability('QUALITY', 'CREATE');
    const body = await req.json() as Record<string, unknown>;
    const input = parseInternalQualityRiskInput({ ...body, workflowVersion: 3 });
    const sourceId = typeof body.sourceQualityRecordId === 'string' ? body.sourceQualityRecordId : '';
    if (sourceId) await requireCapability('QUALITY_DATA', 'READ');
    const report = await prisma.$transaction(async tx => {
      let draft = await createInternalQualityRiskRecord(tx, input, actor(user));
      if (sourceId) {
        const source = await tx.qualityDataRecord.findFirst({ where: { id: sourceId, deletedAt: null, status: 'SUBMITTED' } });
        if (!source) throw new InternalQualityRiskError('来源质量记录不存在、尚未提交或已作废', 400);
        if (!input.workOrderIds.includes(source.workOrderId)) throw new InternalQualityRiskError('必须保留来源检验记录所属工单，其他影响对象可另行关联', 400);
        const data = source.data as { summary?: string };
        draft = await tx.internalQualityRiskReport.update({ where: { id: draft.id }, data: { qualitySource: { id: source.id, code: source.code, version: source.version, title: source.title, workOrderId: source.workOrderId, description: data.summary || source.title, capturedAt: new Date().toISOString() } }, include: internalQualityRiskInclude });
      }
      return body.submit === true ? actOnQualityWorkflow(tx, draft.id, draft.version, 'SUBMIT', {}, qualityRiskActor(user)) : draft;
    });
    await logOp({
      userId: user.id,
      action: 'create_internal_quality_risk',
      targetType: 'internal_quality_risk',
      targetId: report.id,
      detail: { reportNo: report.reportNo, severity: report.severity },
    });
    return NextResponse.json({ ok: true, report: serializeInternalQualityRisk(report) }, { status: 201 });
  } catch (error) {
    return internalQualityRiskRouteError(error, '内部重大异常创建失败');
  }
}
