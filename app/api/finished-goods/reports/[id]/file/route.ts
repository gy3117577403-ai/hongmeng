import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { fgErrorResponse } from '@/lib/finished-goods-http';
import { shippingReportFile } from '@/lib/shipping-report-service';
import { getObjectStream } from '@/lib/s3';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const report = await shippingReportFile(params.id);
    const stream = await getObjectStream(report.objectKey, { abortSignal: request.signal });
    const disposition = request.nextUrl.searchParams.has('download') ? 'attachment' : 'inline';
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, { headers: {
      'Content-Type': 'application/pdf', 'Content-Length': String(report.size),
      'Content-Disposition': `${disposition}; filename="${report.number}.pdf"; filename*=UTF-8''${encodeURIComponent(`${report.number}.pdf`)}`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return fgErrorResponse(error); }
}
