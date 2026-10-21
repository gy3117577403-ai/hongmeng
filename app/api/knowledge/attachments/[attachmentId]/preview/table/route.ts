import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readKnowledgePreviewSheet } from '@/lib/knowledge-preview';
import { paginateKnowledgeSheet } from '@/lib/knowledge-sheet-parser';
import { previewRouteError } from '@/lib/knowledge-preview-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    await requireUser(); const query = new URL(req.url).searchParams;
    const sheet = await readKnowledgePreviewSheet(params.attachmentId, Number(query.get('sheet') || 0));
    return NextResponse.json({ ok: true, sheet: paginateKnowledgeSheet(sheet, Number(query.get('page') || 1), query.get('q') || '') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return previewRouteError(error); }
}
