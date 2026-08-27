import { Readable } from 'node:stream';
import { loadEmployeeQualityWarning } from '@/lib/quality-warning-employee';
import { getObjectStream } from '@/lib/s3';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, { params }: { params: { token: string; attachmentId: string } }) {
  const warning = await loadEmployeeQualityWarning(params.token);
  const attachment = warning?.attachments.find(item => item.id === params.attachmentId);
  if (!attachment) return new Response('此附件不可用或警示已撤销', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const stream = await getObjectStream(attachment.objectKey);
  return new Response(Readable.toWeb(stream) as unknown as BodyInit, { headers: {
    'Content-Type': attachment.mimeType, 'Content-Length': String(attachment.fileSize), 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.displayName)}`,
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
    'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'self'",
  } });
}
