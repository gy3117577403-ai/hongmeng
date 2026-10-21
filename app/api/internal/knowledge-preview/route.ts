import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { processKnowledgePreview } from '@/lib/knowledge-preview';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const expected = Buffer.from(process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '');
  const actual = Buffer.from(request.headers.get('x-outbox-worker-token') || '');
  if (expected.length < 32 || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, result: await processKnowledgePreview() });
}
