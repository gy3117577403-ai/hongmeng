import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parseTerminalToolingSetup,
  serializeTerminalToolingSetup,
  terminalToolingSetupInclude,
  type ParsedTerminalToolingSetupPosition,
} from '@/lib/terminal-tooling';
import {
  nextSetupVersion,
  replaceSetupPositions,
  replaceSetupTags,
} from '@/lib/terminal-tooling-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function referenceErrors(tx: Prisma.TransactionClient, positions: ParsedTerminalToolingSetupPosition[]) {
  if (!positions.length) return [];
  const blades = await tx.terminalToolingBlade.findMany({
    where: { id: { in: positions.map(position => position.bladeId) } },
    select: { id: true, isActive: true, compatiblePositions: true },
  });
  const map = new Map(blades.map(blade => [blade.id, blade]));
  const errors: string[] = [];
  for (const position of positions) {
    const blade = map.get(position.bladeId);
    if (!blade) errors.push('调模方案包含不存在的刀片');
    else if (!blade.isActive) errors.push('调模方案不能选择已停用刀片');
    else if (!blade.compatiblePositions.includes(position.position)) errors.push('所选刀片与刀位不兼容');
  }
  return [...new Set(errors)];
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const existing = await prisma.terminalToolingSetup.findUnique({
      where: { id: params.id },
      include: terminalToolingSetupInclude,
    });
    if (!existing) return NextResponse.json({ ok: false, error: '调模方案不存在' }, { status: 404 });
    if (existing.status !== 'DRAFT') return NextResponse.json({ ok: false, error: '已发布或已归档方案不可直接修改，请复制为新版本' }, { status: 409 });
    const parsed = parseTerminalToolingSetup({
      name: existing.name,
      wireRange: existing.wireRange,
      equipment: existing.equipment,
      mold: existing.mold,
      remark: existing.remark,
      positions: existing.positions.map(position => ({ position: position.position, bladeId: position.bladeId, remark: position.remark })),
      tags: existing.tags.map(link => link.tag.label),
      ...body,
      terminalId: existing.terminalId,
    });
    if (!parsed.data) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    if (parsed.data.lockVersion === null) return NextResponse.json({ ok: false, error: '缺少调模方案版本，请刷新后重试' }, { status: 409 });
    const input = parsed.data;
    const actor = user.displayName || user.username;
    const result = await prisma.$transaction(async tx => {
      const errors = await referenceErrors(tx, input.positions);
      if (errors.length) return { errors, updated: false };
      const version = input.contextKey === existing.contextKey
        ? existing.version
        : await nextSetupVersion(tx, existing.terminalId, input.contextKey);
      const update = await tx.terminalToolingSetup.updateMany({
        where: { id: params.id, status: 'DRAFT', lockVersion: input.lockVersion! },
        data: {
          name: input.name,
          wireRange: input.wireRange,
          equipment: input.equipment,
          mold: input.mold,
          contextKey: input.contextKey,
          version,
          remark: input.remark,
          lockVersion: { increment: 1 },
          updatedBy: actor,
        },
      });
      if (update.count !== 1) return { errors: [] as string[], updated: false };
      await replaceSetupPositions(tx, params.id, input.positions);
      await replaceSetupTags(tx, params.id, input.tags);
      return { errors: [] as string[], updated: true };
    }, { isolationLevel: 'Serializable' });
    if (result.errors.length) return NextResponse.json({ ok: false, error: result.errors.join('；') }, { status: 400 });
    if (!result.updated) return NextResponse.json({ ok: false, error: '调模方案已被其他人修改，请刷新后重试' }, { status: 409 });
    const item = await prisma.terminalToolingSetup.findUniqueOrThrow({
      where: { id: params.id },
      include: terminalToolingSetupInclude,
    });
    await logOp({
      userId: user.id,
      action: 'update_terminal_tooling_setup',
      targetType: 'terminal_tooling_setup',
      targetId: item.id,
      detail: { terminalId: item.terminalId, version: item.version, contextKey: item.contextKey },
    });
    return NextResponse.json({ ok: true, setup: serializeTerminalToolingSetup(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && 'code' in error && (error.code === 'P2002' || error.code === 'P2034')) {
      return NextResponse.json({ ok: false, error: '该端子和适用条件的版本号冲突，请刷新后重试' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: '更新调模方案失败' }, { status: 500 });
  }
}
