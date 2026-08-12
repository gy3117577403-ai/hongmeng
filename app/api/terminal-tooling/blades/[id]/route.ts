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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const existing = await prisma.terminalToolingBlade.findUnique({
      where: { id: params.id },
      include: terminalToolingBladeInclude,
    });
    if (!existing) return NextResponse.json({ ok: false, error: '刀片不存在' }, { status: 404 });
    const parsed = parseTerminalToolingBlade({
      model: existing.model,
      manufacturer: existing.manufacturer,
      compatiblePositions: existing.compatiblePositions,
      specification: existing.specification,
      dimensionA: existing.dimensionA?.toString(),
      dimensionB: existing.dimensionB?.toString(),
      dimensionUnit: existing.dimensionUnit,
      material: existing.material,
      hardness: existing.hardness,
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
    if (parsed.data.lockVersion === null) return NextResponse.json({ ok: false, error: '缺少刀片数据版本，请刷新后重试' }, { status: 409 });
    const input = parsed.data;
    const actor = user.displayName || user.username;
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.terminalToolingBlade.updateMany({
        where: { id: params.id, lockVersion: input.lockVersion! },
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
          lockVersion: { increment: 1 },
          updatedBy: actor,
        },
      });
      if (result.count !== 1) return false;
      await replaceBladeSuppliers(tx, params.id, input.supplierLinks);
      return true;
    });
    if (!updated) return NextResponse.json({ ok: false, error: '刀片已被其他人修改，请刷新后重试' }, { status: 409 });
    const item = await prisma.terminalToolingBlade.findUniqueOrThrow({
      where: { id: params.id },
      include: terminalToolingBladeInclude,
    });
    await logOp({
      userId: user.id,
      action: 'update_terminal_tooling_blade',
      targetType: 'terminal_tooling_blade',
      targetId: item.id,
      detail: { model: item.model, manufacturer: item.manufacturer, isActive: item.isActive },
    });
    return NextResponse.json({ ok: true, blade: serializeTerminalToolingBlade(item) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ ok: false, error: '相同刀片型号和制造商已经存在' }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ ok: false, error: '更新刀片失败' }, { status: 500 });
  }
}
