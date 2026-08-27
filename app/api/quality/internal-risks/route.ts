import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, requireUser } from '@/lib/auth';
import { internalQualityRiskRouteError } from '@/lib/internal-quality-risk-route-response';
import {
  createInternalQualityRiskRecord,
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
    await requireUser();
    const result = await loadInternalQualityRisks({
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
    const report = await prisma.$transaction(async tx => {
      const draft = await createInternalQualityRiskRecord(tx, input, actor(user));
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
