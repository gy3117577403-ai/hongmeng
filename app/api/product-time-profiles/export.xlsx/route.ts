import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  buildProductTimeExcelColumns,
  PRODUCT_TIME_SEQUENCE_HEADER,
} from '@/lib/product-time-excel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const [definitions, items] = await Promise.all([
      prisma.processDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true },
      }),
      prisma.drawingLibraryItem.findMany({
        where: { deletedAt: null },
        orderBy: [{ customerName: 'asc' }, { specification: 'asc' }],
        include: {
          productTimeProfiles: {
            where: { status: { in: ['draft', 'published'] } },
            orderBy: [{ status: 'asc' }, { version: 'desc' }],
            include: { entries: true },
          },
          quotationTimes: {
            where: { status: 'active' },
            orderBy: { version: 'desc' },
            take: 1,
          },
        },
      }),
    ]);
    const selectedProfiles = items.flatMap(item => {
      const profile = item.productTimeProfiles.find(candidate => candidate.status === 'draft')
        || item.productTimeProfiles.find(candidate => candidate.status === 'published')
        || null;
      return profile ? [profile] : [];
    });
    const processColumns = buildProductTimeExcelColumns(definitions, selectedProfiles);
    const rows = items.map(item => {
      const profile = item.productTimeProfiles.find(candidate => candidate.status === 'draft')
        || item.productTimeProfiles.find(candidate => candidate.status === 'published')
        || null;
      const orderedEntries = [...(profile?.entries || [])].sort((left, right) => left.position - right.position);
      const entriesByDefinition = new Map<string, typeof orderedEntries>();
      for (const entry of orderedEntries) {
        entriesByDefinition.set(entry.processDefinitionId, [
          ...(entriesByDefinition.get(entry.processDefinitionId) || []),
          entry,
        ]);
      }
      const quotation = item.quotationTimes[0] || null;
      const row: Record<string, string | number> = {
        产品型号: item.specification,
        客户: item.customerName,
        品名: item.productName || '',
        工时状态: profile ? (profile.status === 'draft' ? '草稿' : '已发布') : '待维护',
        版本: profile ? `V${profile.version}` : '',
      };
      const occurrenceByDefinition = new Map<string, number>();
      row[PRODUCT_TIME_SEQUENCE_HEADER] = JSON.stringify(orderedEntries.flatMap(entry => {
        const occurrence = (occurrenceByDefinition.get(entry.processDefinitionId) || 0) + 1;
        occurrenceByDefinition.set(entry.processDefinitionId, occurrence);
        const column = processColumns.find(candidate => (
          candidate.definitionId === entry.processDefinitionId && candidate.occurrence === occurrence
        ));
        return column ? [{
          header: column.header,
          definitionId: entry.processDefinitionId,
          occurrenceKey: entry.occurrenceKey,
          position: entry.position,
        }] : [];
      }));
      let totalMilliseconds = 0;
      for (const column of processColumns) {
        const entry = entriesByDefinition.get(column.definitionId)?.[column.occurrence - 1];
        row[column.header] = entry ? entry.unitMilliseconds / 1000 : '';
        if (entry) totalMilliseconds += entry.unitMilliseconds;
      }
      row['合计(秒)'] = totalMilliseconds / 1000;
      row['合计(分)'] = Math.round((totalMilliseconds / 60_000) * 1000) / 1000;
      row['报价工时(秒/套)'] = quotation ? quotation.unitMilliseconds / 1000 : '';
      row['报价工时(分/套)'] = quotation ? Math.round((quotation.unitMilliseconds / 60_000) * 1000) / 1000 : '';
      row['报价版本'] = quotation ? `V${quotation.version}` : '';
      return row;
    });
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows, { header: ['产品型号', '客户', '品名', '工时状态', '版本', PRODUCT_TIME_SEQUENCE_HEADER, ...processColumns.map(item => item.header), '合计(秒)', '合计(分)', '报价工时(秒/套)', '报价工时(分/套)', '报价版本'] });
    sheet['!freeze'] = { xSplit: 3, ySplit: 1 };
    sheet['!cols'] = [{}, {}, {}, {}, {}, { hidden: true }];
    XLSX.utils.book_append_sheet(workbook, sheet, '产品标准工时');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('产品标准工时.xlsx')}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('product time export failed', error);
    return NextResponse.json({ ok: false, error: '产品工时导出失败' }, { status: 500 });
  }
}
