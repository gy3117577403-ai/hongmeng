import { NextResponse } from 'next/server';
import { capabilityShowcaseMediaResponse } from '@/lib/capability-showcase-media-response';
import { getCapabilityShowcaseMediaForShare } from '@/lib/capability-showcase-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { token: string; mediaId: string } },
) {
  try {
    const media = await getCapabilityShowcaseMediaForShare({
      token: params.token,
      mediaId: params.mediaId,
    });
    if (!media) return NextResponse.json({ ok: false, error: '图片不存在或分享凭证已失效' }, { status: 404 });
    return capabilityShowcaseMediaResponse(media);
  } catch (error) {
    console.error('capability showcase shared media failed', error);
    return NextResponse.json({ ok: false, error: '图片读取失败' }, { status: 500 });
  }
}
