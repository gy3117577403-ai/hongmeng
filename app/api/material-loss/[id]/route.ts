import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getMaterialLoss, mutateMaterialLoss } from '@/lib/material-loss-service';
import { materialLossFailure } from '@/lib/material-loss-http';
export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { const user = await requireUser(); return NextResponse.json({ ok: true, ...await getMaterialLoss(params.id, user.id) }); } catch (e) { return materialLossFailure(e); }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try { const user = await requireUser(); return NextResponse.json({ ok: true, record: await mutateMaterialLoss(user.id, await req.json(), params.id) }); } catch (e) { return materialLossFailure(e); }
}
