import { NextResponse } from 'next/server';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { requireAdmin } from '@/lib/auth';
import { applyBusinessApprovalHandoff, previewBusinessApprovalHandoff, HandoffError } from '@/lib/business-approval-handoff';
export async function POST(request: Request) {
  try {
    assertSameOriginMutationRequest(request);
    const actor = await requireAdmin();
    const input = await request.json();
    if (typeof input.fromUserId !== 'string' || typeof input.toUserId !== 'string') return NextResponse.json({ ok: false, error: '请选择交出与接替账号' }, { status: 400 });
    if (input.action === 'preview') return NextResponse.json({ ok: true, preview: await previewBusinessApprovalHandoff(input.fromUserId, input.toUserId) });
    if (input.action !== 'apply' || typeof input.fingerprint !== 'string') return NextResponse.json({ ok: false, error: '请先预览交接清单' }, { status: 400 });
    return NextResponse.json({ ok: true, result: await applyBusinessApprovalHandoff(actor.id, input.fromUserId, input.toUserId, input.fingerprint) });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : '交接失败' }, { status: error instanceof HandoffError ? error.status : (error as { status?: number; statusCode?: number }).status || (error as { statusCode?: number }).statusCode || 500 }); }
}
