import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parseTerminalToolingBlade,
  serializeTerminalToolingBlade,
  terminalToolingBladeInclude,
} from '@/lib/terminal-tooling';
import { replaceBladeSuppliers } from '@/lib/terminal-tooling-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = (req.nextUrl.searchParams.get('keyword') || '').trim();
    const active = req.nextUrl.searchParams.get('active');
    const position = req.nextUrl.searchParams.get('position') || '';
    const where: Prisma.TerminalToolingBladeWhereInput = {
      ...(active === 'true' ? { isActive: true } : active === 'false' ? { isActive: false } : {}),
      ...(position ? { compatiblePositions: { has: position as never } } : {}),
      ...(keyword ? {
        OR: [
          { model: { contains: keyword, mode: 'insensitive' } },
          { manufacturer: { contains: keyword, mode: 'insensitive' } },
          { specification: { contains: keyword, mode: 'insensitive' } },
          { material: { contains: keyword, mode: 'insensitive' } },
          { supplierLinks: { some: { supplier: { name: { contains: keyword, mode: 'insensitive' } } } } },
        ],
      } : {}),
    };
    const items = await prisma.terminalToolingBlade.findMany({
      where,
      include: terminalToolingBladeInclude,
      orderBy: [{ isActive: 'desc' }, { model: 'asc' }, { manufacturer: 'asc' }],
      take: 1000,
    });
    return NextResponse.json({ ok: true, blades: items.map(serializeTerminalToolingBlade) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '刀片库加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = parseTerminalToolingBlade(await req.json().catch(() => ({})));
    if (!parsed.data) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    const input = parsed.data;
    const actor = user.displayName || user.username;
    const id = await prisma.$transaction(async tx => {
      const item = await tx.terminalToolingBlade.create({
        data: {
          model: input.model,
          manufacturer: input.manufacturer,
          normalizedKey: input.normalizedKey,
          compatiblePositions: input.compatiblePositions,
          specification: input.specification,
          dimensionA: input.dimensionA,
          dimensionB: input.dimensionB,
          dimensionUnit: input.dimensionUnit,
          material: input.material,
          hardness: input.hardness,
          remark: input.remark,
          isActive: input.isActive,
          createdBy: actor,
          updatedBy: actor,
        },
        select: { id: true },
      });
      await replaceBladeSuppliers(tx, item.id, input.supplierLinks);
      return item.id;
    });
    const item = await prisma.terminalToolingBlade.findUniqueOrThrow({
      where: { id },
      include: terminalToolingBladeInclude,
    });
    await logOp({
      userId: user.id,
      action: 'create_terminal_tooling_blade',
      targetType: 'terminal_tooling_blade',
      targetId: id,
      detail: { model: item.model, manufacturer: item.manufacturer, positions: item.compatiblePositions },
    });
    return NextResponse.json({ ok: true, blade: serializeTerminalToolingBlade(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ ok: false, error: '相同刀片型号和制造商已经存在' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: '新增刀片失败' }, { status: 500 });
  }
}
