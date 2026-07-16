import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { loadDetectedIssues } from '@/lib/issues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const detected = await loadDetectedIssues();
    return NextResponse.json({
      ok: true,
      detected,
      pendingCount: detected.filter(item => !item.existingIssueId).length,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('detected issue list failed', error);
    return NextResponse.json({ ok: false, error: '生产异常收件箱加载失败' }, { status: 500 });
  }
}
