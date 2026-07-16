import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { summarizeIssues } from '@/lib/issues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ ok: true, summary: await summarizeIssues() });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('issue summary failed', error);
    return NextResponse.json({ ok: false, error: '问题统计加载失败' }, { status: 500 });
  }
}
