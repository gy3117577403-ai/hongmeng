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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const existing = await prisma.terminalToolingTerminal.findUnique({
      where: { id: params.id },
      include: terminalToolingTerminalInclude,
    });
    if (!existing) return NextResponse.json({ ok: false, error: '端子不存在' }, { status: 404 });
    const parsed = parseTerminalToolingTerminal({
      specification: existing.specification,
      manufacturer: existing.manufacturer,
      aliases: existing.aliases,
      wireRange: existing.wireRange,
      material: existing.material,
      plating: existing.plating,
      remark: existing.remark,
      isActive: existing.isActive,
      supplierLinks: existing.supplierLinks.map(link => ({
        supplierName: link.supplier.name,
        supplierSku: link.supplierSku,
        productUrl: link.productUrl,
        remark: link.remark,
      })),
      ...body,
    });
    if (!parsed.data) return NextResponse.json({ ok: false, error: parsed.errors.join('；') }, { status: 400 });
    if (parsed.data.lockVersion === null) return NextResponse.json({ ok: false, error: '缺少端子数据版本，请刷新后重试' }, { status: 409 });
    const input = parsed.data;
    const actor = user.displayName || user.username;
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.terminalToolingTerminal.updateMany({
        where: { id: params.id, lockVersion: input.lockVersion! },
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
          lockVersion: { increment: 1 },
          updatedBy: actor,
        },
      });
      if (result.count !== 1) return false;
      await replaceTerminalSuppliers(tx, params.id, input.supplierLinks);
      return true;
    });
    if (!updated) return NextResponse.json({ ok: false, error: '端子已被其他人修改，请刷新后重试' }, { status: 409 });
    const item = await prisma.terminalToolingTerminal.findUniqueOrThrow({
      where: { id: params.id },
      include: terminalToolingTerminalInclude,
    });
    await logOp({
      userId: user.id,
      action: 'update_terminal_tooling_terminal',
      targetType: 'terminal_tooling_terminal',
      targetId: item.id,
      detail: { specification: item.specification, manufacturer: item.manufacturer, isActive: item.isActive },
    });
    return NextResponse.json({ ok: true, terminal: serializeTerminalToolingTerminal(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ ok: false, error: '相同端子规格和制造商已经存在' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: '更新端子失败' }, { status: 500 });
  }
}
