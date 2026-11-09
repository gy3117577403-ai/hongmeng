import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { listMaterialLoss, mutateMaterialLoss } from '@/lib/material-loss-service';
import { materialLossFailure } from '@/lib/material-loss-http';
import { MaterialLossError } from '@/lib/material-loss-domain';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try { const user = await requireUser(); return NextResponse.json({ ok: true, ...await listMaterialLoss(req.nextUrl.searchParams, user.id) }); } catch (e) { return materialLossFailure(e); }
}
export async function POST(req: NextRequest) {
  try { const user = await requireUser(), input = await req.json(); if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MaterialLossError('提交格式不正确'); return NextResponse.json({ ok: true, record: await mutateMaterialLoss(user.id, { ...input, action: 'create' }) }); } catch (e) { return materialLossFailure(e); }
}
