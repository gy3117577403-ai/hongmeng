import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
        },
      }),
    ]);
    const rows = items.map(item => {
      const profile = item.productTimeProfiles.find(candidate => candidate.status === 'draft')
        || item.productTimeProfiles.find(candidate => candidate.status === 'published')
        || null;
      const entryMap = new Map((profile?.entries || []).map(entry => [entry.processDefinitionId, entry]));
      const row: Record<string, string | number> = {
        产品型号: item.specification,
        客户: item.customerName,
        品名: item.productName || '',
        工时状态: profile ? (profile.status === 'draft' ? '草稿' : '已发布') : '待维护',
        版本: profile ? `V${profile.version}` : '',
      };
      let totalMilliseconds = 0;
      for (const definition of definitions) {
        const entry = entryMap.get(definition.id);
        row[definition.name] = entry ? entry.unitMilliseconds / 1000 : '';
        if (entry) totalMilliseconds += entry.unitMilliseconds;
      }
      row['合计(秒)'] = totalMilliseconds / 1000;
      row['合计(分)'] = Math.round((totalMilliseconds / 60_000) * 1000) / 1000;
      return row;
    });
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows, { header: ['产品型号', '客户', '品名', '工时状态', '版本', ...definitions.map(item => item.name), '合计(秒)', '合计(分)'] });
    sheet['!freeze'] = { xSplit: 3, ySplit: 1 };
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
