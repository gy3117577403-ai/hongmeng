import { NextRequest, NextResponse } from 'next/server';

import { listToolingWork, worklogCommand, getToolingJob, getToolingReferences } from '@/lib/tooling-worklog-service';
import { toolingFailure, requireTooling } from '@/lib/tooling-worklog-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) { try { const user = await requireTooling('READ'); const id = req.nextUrl.searchParams.get('id'), terminalId = req.nextUrl.searchParams.get('terminalId'); return NextResponse.json({ ok: true, ...(id ? { job: await getToolingJob(id) } : terminalId ? { references: await getToolingReferences(terminalId) } : await listToolingWork(user, req.nextUrl.searchParams)) }); } catch(e) { return toolingFailure(e); } }
export async function POST(req: NextRequest) { try { const user = await requireTooling('CREATE'); return NextResponse.json({ ok: true, ...await worklogCommand(user, await req.json()) }); } catch(e) { return toolingFailure(e); } }
