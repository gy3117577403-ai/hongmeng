import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { SAMPLE_PLAN_IMPORT_HEADERS } from '@/lib/sample-plan-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '鸿蒙样品计划';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('样品计划导入', {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.mergeCells('A1:G1');
    sheet.getCell('A1').value = '样品计划批量导入模板';
    sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF05A0A' } };
    sheet.getRow(1).height = 30;
    sheet.mergeCells('A2:G2');
    sheet.getCell('A2').value = '每行建立 1 个样品计划；前 6 列必填，图纸库编号可留空由系统自动匹配。请勿改列名。';
    sheet.getCell('A2').font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF9A3412' } };
    sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    sheet.getRow(2).height = 25;
    const header = sheet.getRow(4);
    SAMPLE_PLAN_IMPORT_HEADERS.forEach((name, index) => {
      const cell = header.getCell(index + 1);
      cell.value = name;
      cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });
    header.height = 28;
    sheet.columns = [
      { width: 20 }, { width: 24 }, { width: 34 }, { width: 12 },
      { width: 13 }, { width: 15 }, { width: 34 },
    ];
    for (let rowIndex = 5; rowIndex <= 504; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      row.height = 22;
      for (let column = 1; column <= 7; column += 1) {
        const cell = row.getCell(column);
        cell.font = { name: 'Microsoft YaHei', size: 10 };
        cell.alignment = { vertical: 'middle', wrapText: column === 3 || column === 7 };
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
          right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        };
      }
      row.getCell(4).dataValidation = {
        type: 'list', allowBlank: false, formulae: ['"A,B,C,D"'],
        showErrorMessage: true, errorTitle: '客户等级错误', error: '客户等级只能选择 A、B、C、D。',
      };
      row.getCell(5).dataValidation = {
        type: 'whole', operator: 'greaterThan', formulae: [0], allowBlank: false,
        showErrorMessage: true, errorTitle: '样品数量错误', error: '样品数量必须是大于 0 的整数。',
      };
      row.getCell(6).numFmt = 'yyyy-mm-dd';
      row.getCell(6).dataValidation = {
        type: 'date', operator: 'between', formulae: [new Date('2020-01-01'), new Date('2099-12-31')], allowBlank: false,
        showErrorMessage: true, errorTitle: '计划日期错误', error: '请选择有效的计划日期。',
      };
    }
    sheet.autoFilter = { from: 'A4', to: 'G504' };

    const help = workbook.addWorksheet('填写说明');
    help.columns = [{ width: 22 }, { width: 74 }];
    help.addRow(['项目', '说明']);
    [
      ['前 6 列', '必填：客户名称、产品名称、型号/规格、客户等级、样品数量、计划日期。'],
      ['客户等级', '只能填写 A、B、C、D；系统固定显示为 A红、B黄、C蓝、D绿。'],
      ['图纸库编号', '选填。已明确知道图纸库编号时填写，可精确复用；留空时系统按客户和型号/规格自动匹配。'],
      ['匹配结果', '唯一精确匹配直接复用；没有匹配自动新建；相似但不唯一时上传预览会要求人工确认。'],
      ['重复数据', '同一文件中的重复行、以及系统内已有的同产品/等级/数量/计划日期任务会被阻止，不提供强制重复导入。'],
      ['导入上限', '每个文件最多 500 行有效数据，只支持 .xlsx。'],
    ].forEach(values => help.addRow(values));
    help.getRow(1).font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' } };
    help.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF05A0A' } };
    help.eachRow(row => {
      row.height = 28;
      row.eachCell(cell => {
        cell.font = { ...cell.font, name: 'Microsoft YaHei', size: cell.font?.size || 10 };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('样品计划批量导入模板.xlsx')}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('sample plan template failed', error);
    return NextResponse.json({ ok: false, error: '模板生成失败，请稍后重试' }, { status: 500 });
  }
}
