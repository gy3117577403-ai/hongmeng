import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parseTerminalToolingTerminal,
  serializeTerminalToolingTerminal,
  terminalToolingTerminalInclude,
} from '@/lib/terminal-tooling';
import { replaceTerminalSuppliers } from '@/lib/terminal-tooling-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function duplicateError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'P2002';
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = (req.nextUrl.searchParams.get('keyword') || '').trim();
    const active = req.nextUrl.searchParams.get('active');
    const where: Prisma.TerminalToolingTerminalWhereInput = {
      ...(active === 'true' ? { isActive: true } : active === 'false' ? { isActive: false } : {}),
      ...(keyword ? {
        OR: [
          { specification: { contains: keyword, mode: 'insensitive' } },
          { manufacturer: { contains: keyword, mode: 'insensitive' } },
          { aliases: { has: keyword } },
          { wireRange: { contains: keyword, mode: 'insensitive' } },
          { supplierLinks: { some: { supplier: { name: { contains: keyword, mode: 'insensitive' } } } } },
        ],
      } : {}),
    };
    const items = await prisma.terminalToolingTerminal.findMany({
      where,
      include: terminalToolingTerminalInclude,
      orderBy: [{ isActive: 'desc' }, { specification: 'asc' }, { manufacturer: 'asc' }],
      take: 500,
    });
    return NextResponse.json({ ok: true, terminals: items.map(serializeTerminalToolingTerminal) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '端子库加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = parseTerminalToolingTerminal(await req.json().catch(() => ({})));
    if (!parsed.data) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const input = parsed.data;
    const actor = user.displayName || user.username;
    const id = await prisma.$transaction(async tx => {
      const item = await tx.terminalToolingTerminal.create({
        data: {
          specification: input.specification,
          manufacturer: input.manufacturer,
          normalizedKey: input.normalizedKey,
          aliases: input.aliases,
          wireRange: input.wireRange,
          material: input.material,
          plating: input.plating,
          remark: input.remark,
          isActive: input.isActive,
          createdBy: actor,
          updatedBy: actor,
        },
        select: { id: true },
      });
      await replaceTerminalSuppliers(tx, item.id, input.supplierLinks);
      return item.id;
    });
    const item = await prisma.terminalToolingTerminal.findUniqueOrThrow({
      where: { id },
      include: terminalToolingTerminalInclude,
    });
    await logOp({
      userId: user.id,
      action: 'create_terminal_tooling_terminal',
      targetType: 'terminal_tooling_terminal',
      targetId: id,
      detail: { specification: item.specification, manufacturer: item.manufacturer },
    });
    return NextResponse.json({ ok: true, terminal: serializeTerminalToolingTerminal(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (duplicateError(error)) return NextResponse.json({ ok: false, error: '相同端子规格和制造商已经存在' }, { status: 409 });
    console.error(error);
    return NextResponse.json({ ok: false, error: '新增端子失败' }, { status: 500 });
  }
}
