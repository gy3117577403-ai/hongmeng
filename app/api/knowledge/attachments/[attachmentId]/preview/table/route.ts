import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readKnowledgePreviewPage } from '@/lib/knowledge-preview';
import { previewRouteError } from '@/lib/knowledge-preview-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    await requireUser(); const query = new URL(req.url).searchParams;
    const sheet = await readKnowledgePreviewPage(params.attachmentId, Number(query.get('sheet') || 0), Number(query.get('page') || 1), query.get('q') || '', query.has('column') ? Number(query.get('column')) : undefined);
    return NextResponse.json({ ok: true, sheet }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return previewRouteError(error); }
}
