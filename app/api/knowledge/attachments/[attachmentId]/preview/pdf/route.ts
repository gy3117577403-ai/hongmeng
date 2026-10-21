import { Readable } from 'node:stream';
import { requireUser } from '@/lib/auth';
import { readableKnowledgePreview, KnowledgePreviewError } from '@/lib/knowledge-preview';
import { getObjectStream } from '@/lib/s3';
import { previewRouteError } from '@/lib/knowledge-preview-route';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request, { params }: { params: { attachmentId: string } }) {
  try {
    await requireUser(); const preview = await readableKnowledgePreview(params.attachmentId);
    if (preview.pdfStatus !== 'ready' || !preview.pdfKey) throw new KnowledgePreviewError('版式预览尚未生成', 404);
    const stream = await getObjectStream(preview.pdfKey, { abortSignal: req.signal });
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': "inline; filename=preview.pdf",
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return previewRouteError(error); }
}
