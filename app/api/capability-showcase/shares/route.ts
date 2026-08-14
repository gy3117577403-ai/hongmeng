import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { capabilityShowcaseApiError } from '@/lib/capability-showcase-api';
import { createCapabilityShowcaseShare } from '@/lib/capability-showcase-service';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null) as null | { label?: unknown; expiresInDays?: unknown };
    const result = await createCapabilityShowcaseShare({
      userId: user.id,
      label: body?.label,
      expiresInDays: body?.expiresInDays,
    });
    await logOp({
      userId: user.id,
      action: 'create_capability_showcase_share',
      targetType: 'capability_showcase_share',
      targetId: result.share.id,
      detail: { tokenPrefix: result.share.tokenPrefix, expiresAt: result.share.expiresAt },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return capabilityShowcaseApiError(error, '分享链接创建失败');
  }
}
