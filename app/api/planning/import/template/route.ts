import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = [
  '来源订单号', '订单行号', '订单日期', '客户名称', '产品名称', '型号/规格',
  '订单总量', '本周排产量', '客户交期', '计划完成日期', '图纸库编号',
  '客户等级', '业务员', '备注',
];

export async function GET() {
  try {
    await requireUser();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '鸿蒙量产计划';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('量产计划导入', {
      views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.mergeCells('A1:N1');
    sheet.getCell('A1').value = '量产计划批量导入模板';
    sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF05A0A' } };
    sheet.getRow(1).height = 30;
    sheet.mergeCells('A2:N2');
    sheet.getCell('A2').value = '橙色列必填；灰色列选填。已有产品自动复用原图纸库，未建档产品才自动新建。请勿修改列名。';
    sheet.getCell('A2').font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF9A3412' } };
    sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    sheet.getRow(2).height = 26;

    const header = sheet.getRow(4);
    headers.forEach((name, index) => {
      const required = index < 9;
      const cell = header.getCell(index + 1);
      cell.value = required ? `${name}*` : name;
      cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? 'FFF05A0A' : 'FF64748B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });
    header.height = 30;
    sheet.columns = [
      { width: 20 }, { width: 11 }, { width: 14 }, { width: 20 }, { width: 24 }, { width: 30 },
      { width: 13 }, { width: 15 }, { width: 14 }, { width: 16 }, { width: 24 }, { width: 12 },
      { width: 16 }, { width: 32 },
    ];
    for (let rowIndex = 5; rowIndex <= 504; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      row.height = 23;
      for (let column = 1; column <= headers.length; column += 1) {
        const cell = row.getCell(column);
        cell.font = { name: 'Microsoft YaHei', size: 10 };
        cell.alignment = { vertical: 'middle', wrapText: column === 5 || column === 6 || column === 14 };
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFE2E8F0' } }, left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } }, right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        };
      }
      row.getCell(1).numFmt = '@';
      row.getCell(2).dataValidation = { type: 'whole', operator: 'greaterThan', formulae: [0], allowBlank: false };
      for (const column of [3, 9, 10]) row.getCell(column).numFmt = 'yyyy-mm-dd';
      for (const column of [7, 8]) {
        row.getCell(column).dataValidation = { type: 'whole', operator: 'greaterThan', formulae: [0], allowBlank: false };
      }
      row.getCell(12).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"A,B,C,D"'],
        showErrorMessage: true, errorTitle: '客户等级错误', error: '客户等级只能填写 A、B、C 或 D。',
      };
    }
    sheet.autoFilter = { from: 'A4', to: 'N504' };

    const help = workbook.addWorksheet('填写说明');
    help.columns = [{ width: 22 }, { width: 82 }];
    help.addRow(['项目', '说明']);
    [
      ['必填列', '来源订单号、订单行号、订单日期、客户名称、产品名称、型号/规格、订单总量、本周排产量、客户交期。'],
      ['计划完成日期', '选填；留空时使用导入目标周的周日，填写时必须位于目标生产周内。'],
      ['图纸库编号', '选填；明确知道原图纸库时填写，可精确复用。留空则按客户名称+型号/规格自动匹配。'],
      ['产品档案规则', '唯一匹配直接复用；唯一归档档案自动恢复；没有匹配才新建空白档案；多个匹配必须在预览页人工选择。'],
      ['资料保护', '复用或恢复只建立关联，不复制、不覆盖、不清空原有图纸、SOP、产品工时及其他资料。'],
      ['重复规则', '同一来源订单号+订单行号在同一目标周只允许一个批次；重复行自动跳过，不累加数量。'],
      ['数量口径', '订单总量是订单行总数；本周排产量是本次目标周数量，两者不能混用。'],
      ['示例', 'SO20260903001 | 1 | 2026-09-03 | 示例客户 | 示例线束 | ABC-001 | 1000 | 300 | 2026-09-30'],
    ].forEach(values => help.addRow(values));
    help.getRow(1).font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' } };
    help.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF05A0A' } };
    help.eachRow(row => {
      row.height = 30;
      row.eachCell(cell => {
        cell.font = { ...cell.font, name: 'Microsoft YaHei', size: cell.font?.size || 10 };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('量产计划批量导入模板.xlsx')}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('production plan import template failed', error);
    return NextResponse.json({ ok: false, error: '模板生成失败，请稍后重试' }, { status: 500 });
  }
}
