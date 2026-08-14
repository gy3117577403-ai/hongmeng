import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { capabilityShowcaseApiError } from '@/lib/capability-showcase-api';
import { publishCapabilityShowcase } from '@/lib/capability-showcase-service';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null) as null | { expectedRevision?: unknown };
    const publication = await publishCapabilityShowcase({
      userId: user.id,
      expectedRevision: Number(body?.expectedRevision),
    });
    await logOp({
      userId: user.id,
      action: 'publish_capability_showcase',
      targetType: 'capability_showcase_publication',
      targetId: publication.id,
      detail: { revision: publication.revision },
    });
    return NextResponse.json({ ok: true, publication });
  } catch (error) {
    return capabilityShowcaseApiError(error, '能力展厅发布失败');
  }
}
