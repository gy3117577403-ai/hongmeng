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

async function validateDraftReferences(
  tx: Prisma.TransactionClient,
  terminalId: string,
  positions: ParsedTerminalToolingSetupPosition[],
) {
  const terminal = await tx.terminalToolingTerminal.findUnique({
    where: { id: terminalId },
    select: { id: true, isActive: true },
  });
  if (!terminal) return ['所选端子不存在'];
  if (!terminal.isActive) return ['已停用端子不能新建调模方案'];
  if (!positions.length) return [];
  const blades = await tx.terminalToolingBlade.findMany({
    where: { id: { in: positions.map(position => position.bladeId) } },
    select: { id: true, isActive: true, compatiblePositions: true },
  });
  const bladeMap = new Map(blades.map(blade => [blade.id, blade]));
  const errors: string[] = [];
  for (const position of positions) {
    const blade = bladeMap.get(position.bladeId);
    if (!blade) errors.push('调模方案包含不存在的刀片');
    else if (!blade.isActive) errors.push('调模方案不能选择已停用刀片');
    else if (!blade.compatiblePositions.includes(position.position)) errors.push('所选刀片与刀位不兼容');
  }
  return [...new Set(errors)];
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const terminalId = (req.nextUrl.searchParams.get('terminalId') || '').trim();
    const status = (req.nextUrl.searchParams.get('status') || '').trim();
    const keyword = (req.nextUrl.searchParams.get('keyword') || '').trim();
    const where: Prisma.TerminalToolingSetupWhereInput = {
      ...(terminalId ? { terminalId } : {}),
      ...(['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status) ? { status: status as never } : {}),
      ...(keyword ? {
        OR: [
          { terminal: { specification: { contains: keyword, mode: 'insensitive' } } },
          { terminal: { manufacturer: { contains: keyword, mode: 'insensitive' } } },
          { name: { contains: keyword, mode: 'insensitive' } },
          { wireRange: { contains: keyword, mode: 'insensitive' } },
          { equipment: { contains: keyword, mode: 'insensitive' } },
          { mold: { contains: keyword, mode: 'insensitive' } },
          { tags: { some: { tag: { label: { contains: keyword, mode: 'insensitive' } } } } },
        ],
      } : {}),
    };
    const items = await prisma.terminalToolingSetup.findMany({
      where,
      include: terminalToolingSetupInclude,
      orderBy: [{ terminal: { specification: 'asc' } }, { contextKey: 'asc' }, { version: 'desc' }],
      take: 1000,
    });
    return NextResponse.json({ ok: true, setups: items.map(serializeTerminalToolingSetup) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '调模方案加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = parseTerminalToolingSetup(await req.json().catch(() => ({})));
    if (!parsed.data) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const input = parsed.data;
    const actor = user.displayName || user.username;
    const result = await prisma.$transaction(async tx => {
      const referenceErrors = await validateDraftReferences(tx, input.terminalId, input.positions);
      if (referenceErrors.length) return { errors: referenceErrors, id: null };
      const version = await nextSetupVersion(tx, input.terminalId, input.contextKey);
      const item = await tx.terminalToolingSetup.create({
        data: {
          terminalId: input.terminalId,
          name: input.name,
          wireRange: input.wireRange,
          equipment: input.equipment,
          mold: input.mold,
          contextKey: input.contextKey,
          version,
          remark: input.remark,
          createdBy: actor,
          updatedBy: actor,
        },
        select: { id: true },
      });
      await replaceSetupPositions(tx, item.id, input.positions);
      await replaceSetupTags(tx, item.id, input.tags);
      return { errors: [] as string[], id: item.id };
    }, { isolationLevel: 'Serializable' });
    if (result.errors.length || !result.id) {
      return NextResponse.json({ ok: false, error: result.errors.join('；') || '调模方案保存失败' }, { status: 400 });
    }
    const item = await prisma.terminalToolingSetup.findUniqueOrThrow({
      where: { id: result.id },
      include: terminalToolingSetupInclude,
    });
    await logOp({
      userId: user.id,
      action: 'create_terminal_tooling_setup',
      targetType: 'terminal_tooling_setup',
      targetId: item.id,
      detail: { terminalId: item.terminalId, version: item.version, contextKey: item.contextKey },
    });
    return NextResponse.json({ ok: true, setup: serializeTerminalToolingSetup(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && 'code' in error && (error.code === 'P2002' || error.code === 'P2034')) {
      return NextResponse.json({ ok: false, error: '该端子和适用条件的版本号冲突，请重试' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: '新增调模方案失败' }, { status: 500 });
  }
}
