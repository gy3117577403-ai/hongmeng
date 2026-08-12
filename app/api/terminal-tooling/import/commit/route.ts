import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  parseTerminalToolingBlade,
  parseTerminalToolingTerminal,
  terminalToolingImportRowInput,
  type TerminalToolingImportEntity,
  type TerminalToolingImportRow,
} from '@/lib/terminal-tooling';
import { replaceBladeSuppliers, replaceTerminalSuppliers } from '@/lib/terminal-tooling-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as {
      entity?: TerminalToolingImportEntity;
      rows?: TerminalToolingImportRow[];
      fileName?: string;
    };
    if (body.entity !== 'terminals' && body.entity !== 'blades') return NextResponse.json({ ok: false, error: '导入类型无效' }, { status: 400 });
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
    if (!rows.length) return NextResponse.json({ ok: false, error: '缺少待导入数据' }, { status: 400 });
    const actor = user.displayName || user.username;
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ row: string; message: string }> = [];

    for (const row of rows) {
      if (row.status !== 'ready') {
        skipped += 1;
        continue;
      }
      try {
        if (body.entity === 'terminals') {
          const parsed = parseTerminalToolingTerminal(terminalToolingImportRowInput(body.entity, row));
          if (!parsed.data) throw new Error(parsed.errors.join('；'));
          const input = parsed.data;
          await prisma.$transaction(async tx => {
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
                createdBy: actor,
                updatedBy: actor,
              },
              select: { id: true },
            });
            await replaceTerminalSuppliers(tx, item.id, input.supplierLinks);
          });
        } else {
          const parsed = parseTerminalToolingBlade(terminalToolingImportRowInput(body.entity, row));
          if (!parsed.data) throw new Error(parsed.errors.join('；'));
          const input = parsed.data;
          await prisma.$transaction(async tx => {
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
                createdBy: actor,
                updatedBy: actor,
              },
              select: { id: true },
            });
            await replaceBladeSuppliers(tx, item.id, input.supplierLinks);
          });
        }
        created += 1;
      } catch (error) {
        failed += 1;
        errors.push({ row: row.index, message: error instanceof Error && 'code' in error && error.code === 'P2002' ? '重复数据' : error instanceof Error ? error.message : '导入失败' });
      }
    }
    await logOp({
      userId: user.id,
      action: `import_terminal_tooling_${body.entity}`,
      targetType: `terminal_tooling_${body.entity}`,
      detail: { fileName: body.fileName || null, created, skipped, failed, total: rows.length },
    });
    return NextResponse.json({ ok: true, summary: { created, skipped, failed, total: rows.length }, errors: errors.slice(0, 50) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return NextResponse.json({ ok: false, error: '确认导入失败' }, { status: 500 });
  }
}
