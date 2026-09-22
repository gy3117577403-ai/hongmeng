import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { resolveConnectorConflict } from '@/lib/connector-parameter-conflicts';
import { SamplePublishError } from '@/lib/sample-team-publish';
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: '请求无效' }, { status: 400 });
    const item = await resolveConnectorConflict(params.id, body, { id: user.id, name: user.displayName || user.username });
    return NextResponse.json({ ok: true, item });
  } catch (e) { if (e instanceof UnauthorizedError) return unauthorized(); if (e instanceof SamplePublishError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: e.status }); if (e instanceof SyntaxError) return NextResponse.json({ ok: false, error: '请求无效' }, { status: 400 }); console.error(e); return NextResponse.json({ ok: false, error: '参数处理失败，请刷新重试' }, { status: 500 }); }
}
