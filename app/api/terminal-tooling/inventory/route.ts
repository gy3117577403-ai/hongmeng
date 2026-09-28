import { NextRequest, NextResponse } from 'next/server';

import { getToolingInventory, inventoryCommand } from '@/lib/tooling-worklog-service';
import { toolingFailure, requireTooling } from '@/lib/tooling-worklog-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { try { await requireTooling('READ'); return NextResponse.json({ ok: true, blades: await getToolingInventory() }); } catch(e) { return toolingFailure(e); } }
export async function POST(req: NextRequest) { try { const user = await requireTooling('UPDATE'); return NextResponse.json({ ok: true, ...await inventoryCommand(user, await req.json()) }); } catch(e) { return toolingFailure(e); } }
