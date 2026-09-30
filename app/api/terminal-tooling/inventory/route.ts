import { NextRequest, NextResponse } from 'next/server';

import { getToolingInventory, getToolingMolds, getToolingInventoryHistory, inventoryCommand } from '@/lib/tooling-worklog-service';
import { toolingFailure, requireTooling } from '@/lib/tooling-worklog-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) { try { await requireTooling('READ'); const moldId = req.nextUrl.searchParams.get('moldId') || undefined, bladeId = req.nextUrl.searchParams.get('bladeId') || undefined; if (moldId || bladeId) return NextResponse.json({ ok: true, events: await getToolingInventoryHistory(moldId, bladeId) }); const [blades, molds] = await Promise.all([getToolingInventory(), getToolingMolds()]); return NextResponse.json({ ok: true, blades, molds }); } catch(e) { return toolingFailure(e); } }
export async function POST(req: NextRequest) { try { const user = await requireTooling('UPDATE'); return NextResponse.json({ ok: true, ...await inventoryCommand(user, await req.json()) }); } catch(e) { return toolingFailure(e); } }
