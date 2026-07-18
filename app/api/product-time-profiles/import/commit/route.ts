import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validateProductTimeEntries } from '@/lib/product-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportRow = { itemId?: unknown; entries?: unknown; rowNo?: unknown };

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as { rows?: unknown };
    if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 800) {
      return NextResponse.json({ ok: false, error: '请选择 1-800 条可导入产品' }, { status: 400 });
    }
    const validated = body.rows.map((raw, index) => {
      const row = raw as ImportRow;
      const itemId = String(row.itemId || '').trim();
      const entries = validateProductTimeEntries(row.entries);
      if (!itemId || !entries.ok || !entries.entries.length) {
        throw new Error(`第 ${Number(row.rowNo) || index + 1} 行数据不正确${entries.ok ? '' : `：${entries.error}`}`);
      }
      return { itemId, entries: entries.entries, rowNo: Number(row.rowNo) || index + 1 };
    });
    const itemIds = [...new Set(validated.map(row => row.itemId))];
    if (itemIds.length !== validated.length) {
      return NextResponse.json({ ok: false, error: '导入内容包含重复产品，请每个产品只保留一行' }, { status: 400 });
    }
    const result = await prisma.$transaction(async tx => {
      const items = await tx.drawingLibraryItem.findMany({
        where: { id: { in: itemIds }, deletedAt: null },
        select: { id: true },
      });
      if (items.length !== itemIds.length) throw new Error('PRODUCT_ITEM_MISSING');
      const definitionIds = [...new Set(validated.flatMap(row => row.entries.map(entry => entry.processDefinitionId)))];
      const definitions = await tx.processDefinition.count({ where: { id: { in: definitionIds }, isActive: true } });
      if (definitions !== definitionIds.length) throw new Error('PROCESS_DEFINITION_INVALID');

      let createdDrafts = 0;
      let updatedDrafts = 0;
      for (const row of validated) {
        let draft = await tx.productTimeProfile.findFirst({
          where: { drawingLibraryItemId: row.itemId, status: 'draft' },
          select: { id: true, version: true },
        });
        if (!draft) {
          const latest = await tx.productTimeProfile.aggregate({ where: { drawingLibraryItemId: row.itemId }, _max: { version: true } });
          draft = await tx.productTimeProfile.create({
            data: {
              drawingLibraryItemId: row.itemId,
              version: (latest._max.version || 0) + 1,
              status: 'draft',
              sourceType: 'excel_import',
              remark: `Excel 导入第 ${row.rowNo} 行`,
              createdById: user.id,
              updatedById: user.id,
            },
            select: { id: true, version: true },
          });
          createdDrafts += 1;
        } else {
          await tx.productTimeProfile.update({
            where: { id: draft.id },
            data: { revision: { increment: 1 }, sourceType: 'excel_import', updatedById: user.id },
          });
          await tx.productProcessTimeEntry.deleteMany({ where: { profileId: draft.id } });
          updatedDrafts += 1;
        }
        await tx.productProcessTimeEntry.createMany({ data: row.entries.map(entry => ({ ...entry, profileId: draft!.id })) });
        await tx.operationLog.create({
          data: {
            userId: user.id,
            action: 'import_product_time_profile',
            targetType: 'product_time_profile',
            targetId: draft.id,
            detail: { drawingLibraryItemId: row.itemId, version: draft.version, processCount: row.entries.length, sourceRowNo: row.rowNo },
          },
        });
      }
      return { imported: validated.length, createdDrafts, updatedDrafts };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'PRODUCT_ITEM_MISSING') return NextResponse.json({ ok: false, error: '部分产品已删除，请重新预览' }, { status: 409 });
      if (error.message === 'PROCESS_DEFINITION_INVALID') return NextResponse.json({ ok: false, error: '部分工序已停用，请重新预览' }, { status: 409 });
      if (error.message.startsWith('第 ')) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error('product time import commit failed', error);
    return NextResponse.json({ ok: false, error: '产品工时导入失败' }, { status: 500 });
  }
}
