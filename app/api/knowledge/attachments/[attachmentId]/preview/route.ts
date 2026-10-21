import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { ensureKnowledgePreview, serializeOfficePreview } from '@/lib/knowledge-preview';
import { previewRouteError } from '@/lib/knowledge-preview-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(attachmentId: string, retry: boolean) {
  try { await requireUser(); return NextResponse.json({ ok: true, preview: serializeOfficePreview(await ensureKnowledgePreview(attachmentId, retry)) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return previewRouteError(error); }
}
export async function GET(_req: Request, { params }: { params: { attachmentId: string } }) { return handle(params.attachmentId, false); }
export async function POST(_req: Request, { params }: { params: { attachmentId: string } }) { return handle(params.attachmentId, true); }
