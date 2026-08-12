import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  serializeTerminalToolingSetup,
  terminalToolingSetupInclude,
} from '@/lib/terminal-tooling';
import {
  nextSetupVersion,
  replaceSetupPositions,
  replaceSetupTags,
} from '@/lib/terminal-tooling-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const source = await prisma.terminalToolingSetup.findUnique({
      where: { id: params.id },
      include: terminalToolingSetupInclude,
    });
    if (!source) return NextResponse.json({ ok: false, error: '源调模方案不存在' }, { status: 404 });
    if (!source.terminal.isActive) return NextResponse.json({ ok: false, error: '端子已停用，不能创建新版本' }, { status: 400 });
    const actor = user.displayName || user.username;
    const id = await prisma.$transaction(async tx => {
      const version = await nextSetupVersion(tx, source.terminalId, source.contextKey);
      const item = await tx.terminalToolingSetup.create({
        data: {
          terminalId: source.terminalId,
          name: source.name,
          wireRange: source.wireRange,
          equipment: source.equipment,
          mold: source.mold,
          contextKey: source.contextKey,
          version,
          remark: source.remark,
          createdBy: actor,
          updatedBy: actor,
        },
        select: { id: true },
      });
      await replaceSetupPositions(tx, item.id, source.positions.map(position => ({
        position: position.position,
        bladeId: position.bladeId,
        remark: position.remark,
      })));
      await replaceSetupTags(tx, item.id, source.tags.map(link => link.tag.label));
      return item.id;
    }, { isolationLevel: 'Serializable' });
    const item = await prisma.terminalToolingSetup.findUniqueOrThrow({ where: { id }, include: terminalToolingSetupInclude });
    await logOp({
      userId: user.id,
      action: 'duplicate_terminal_tooling_setup',
      targetType: 'terminal_tooling_setup',
      targetId: id,
      detail: { sourceId: source.id, version: item.version },
    });
    return NextResponse.json({ ok: true, setup: serializeTerminalToolingSetup(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && 'code' in error && (error.code === 'P2002' || error.code === 'P2034')) {
      return NextResponse.json({ ok: false, error: '复制版本发生并发冲突，请刷新后重试' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: '复制调模方案失败' }, { status: 500 });
  }
}
