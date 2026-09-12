import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { processMaterialPhotoMedia } from '@/lib/material-photo-media';
import { backgroundMaintenanceGate } from '@/lib/maintenance-single-flight';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const expected = Buffer.from(process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '');
  const actual = Buffer.from(request.headers.get('x-outbox-worker-token') || '');
  if (expected.length < 32 || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return NextResponse.json({ ok: false }, { status: 404 });
  const flight = await backgroundMaintenanceGate.run({ requestId: crypto.randomUUID(), phase: 'material_photo_media' }, processMaterialPhotoMedia);
  if (!flight.started) return NextResponse.json({ ok: false, code: 'BACKGROUND_MAINTENANCE_ALREADY_RUNNING' }, { status: 409, headers: { 'Retry-After': '30' } });
  return NextResponse.json({ ok: true, result: flight.value });
}
