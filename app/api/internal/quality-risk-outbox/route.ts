import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { dispatchQualityNotifications } from '@/lib/quality-risk-notifications';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const expected = Buffer.from(process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '');
  const actual = Buffer.from(req.headers.get('x-outbox-worker-token') || '');
  if (expected.length < 32 || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return NextResponse.json({ ok: false }, { status: 404 });
  const result = await dispatchQualityNotifications();
  return NextResponse.json({ ok: true, result });
}
