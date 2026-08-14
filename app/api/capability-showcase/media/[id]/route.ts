import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { capabilityShowcaseApiError } from '@/lib/capability-showcase-api';
import { deleteCapabilityShowcaseMedia } from '@/lib/capability-showcase-service';
import { logOp } from '@/lib/logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    await deleteCapabilityShowcaseMedia({ userId: user.id, mediaId: params.id });
    await logOp({
      userId: user.id,
      action: 'delete_capability_showcase_media',
      targetType: 'capability_showcase_media',
      targetId: params.id,
      detail: { mode: 'soft-delete' },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return capabilityShowcaseApiError(error, '图片删除失败');
  }
}
