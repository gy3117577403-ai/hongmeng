import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { capabilityShowcaseApiError } from '@/lib/capability-showcase-api';
import { revokeCapabilityShowcaseShare } from '@/lib/capability-showcase-service';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await revokeCapabilityShowcaseShare({ userId: user.id, shareId: params.id });
    await logOp({
      userId: user.id,
      action: 'revoke_capability_showcase_share',
      targetType: 'capability_showcase_share',
      targetId: params.id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return capabilityShowcaseApiError(error, '分享链接停用失败');
  }
}
