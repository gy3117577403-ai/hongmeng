import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { capabilityShowcaseApiError } from '@/lib/capability-showcase-api';
import { capabilityShowcaseMediaResponse } from '@/lib/capability-showcase-media-response';
import { getCapabilityShowcaseMediaForDraft } from '@/lib/capability-showcase-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const media = await getCapabilityShowcaseMediaForDraft(params.id, user.id);
    if (!media) return NextResponse.json({ ok: false, error: '图片不存在或已删除' }, { status: 404 });
    return capabilityShowcaseMediaResponse(media);
  } catch (error) {
    return capabilityShowcaseApiError(error, '图片读取失败');
  }
}
