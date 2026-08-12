import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import {
  serializeTerminalToolingSetup,
} from '@/lib/terminal-tooling';
import {
  publishTerminalToolingSetup,
  TerminalToolingPublishError,
} from '@/lib/terminal-tooling-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { lockVersion?: unknown };
    const expectedVersion = Number(body.lockVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json({ ok: false, error: '缺少调模方案版本，请刷新后重试' }, { status: 409 });
    }
    const actor = user.displayName || user.username;
    const item = await publishTerminalToolingSetup({
      setupId: params.id,
      expectedVersion,
      actor,
    });
    await logOp({
      userId: user.id,
      action: 'publish_terminal_tooling_setup',
      targetType: 'terminal_tooling_setup',
      targetId: item.id,
      detail: { terminalId: item.terminalId, version: item.version, contextKey: item.contextKey },
    });
    return NextResponse.json({ ok: true, setup: serializeTerminalToolingSetup(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TerminalToolingPublishError) {
      const status = error.kind === 'NOT_FOUND' ? 404 : error.kind === 'VALIDATION' ? 400 : 409;
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }
    if (error instanceof Error && 'code' in error && error.code === 'P2034') {
      return NextResponse.json({ ok: false, error: '发布时数据已发生变化，请刷新后重试' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: '发布调模方案失败' }, { status: 500 });
  }
}
