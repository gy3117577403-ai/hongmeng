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
    workbook.creator = '杭连采购';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('样品计划导入', {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.mergeCells('A1:Q1');
    sheet.getCell('A1').value = '样品计划批量导入模板';
    sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF05A0A' } };
    sheet.getRow(1).height = 30;
    sheet.mergeCells('A2:Q2');
    sheet.getCell('A2').value = '每行建立 1 个样品计划；前 6 列必填，图纸库编号可留空由系统自动匹配。请勿改列名。';
    sheet.getCell('A2').font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF9A3412' } };
    sheet.getCell('A2').alignment = { vertical: 'middle', wrapText: true };
    sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    sheet.getRow(2).height = 25;
    const header = sheet.getRow(4);
    SAMPLE_PLAN_IMPORT_HEADERS.forEach((name, index) => {
      const cell = header.getCell(index + 1);
      cell.value = name === '计划日期' ? '客户交期' : name;
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
      { width: 13 }, { width: 15 }, { width: 34 }, { width: 23 }, { width: 23 },
      { width: 20 }, { width: 22 }, { width: 23 }, {width:26}, {width:26}, {width:20}, {width:32}, {width:32},
    ];
    for (let rowIndex = 5; rowIndex <= 504; rowIndex += 1) {
      const row = sheet.getRow(rowIndex);
      row.height = 22;
      for (let column = 1; column <= SAMPLE_PLAN_IMPORT_HEADERS.length; column += 1) {
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
      row.getCell(8).numFmt = 'yyyy-mm-dd';
      row.getCell(10).dataValidation = { type: 'list', allowBlank: true, formulae: ['"新品,老产品"'], showErrorMessage: true, error: '请选择新品或老产品' };
      row.getCell(11).numFmt = 'yyyy-mm-dd';
      row.getCell(12).numFmt = 'yyyy-mm-dd';
      row.getCell(13).numFmt = '0.###';
      row.getCell(13).dataValidation = {type:'decimal',operator:'between',formulae:[0.001,1440],allowBlank:true,showErrorMessage:true,error:'填写每套分钟数，最多三位小数，范围 0.001 至 1440。'};
      row.getCell(9).dataValidation = { type: 'whole', operator: 'between', formulae: [0, 30], allowBlank: true, showErrorMessage: true, error: '请输入 0 至 30 的整数' };
      row.getCell(6).numFmt = 'yyyy-mm-dd';
      row.getCell(6).dataValidation = {
        type: 'date', operator: 'between', formulae: [new Date('2020-01-01'), new Date('2099-12-31')], allowBlank: false,
        showErrorMessage: true, errorTitle: '计划日期错误', error: '请选择有效的计划日期。',
      };
    }
    sheet.autoFilter = { from: 'A4', to: 'Q504' };

    const help = workbook.addWorksheet('填写说明');
    help.columns = [{ width: 22 }, { width: 74 }];
    help.addRow(['项目', '说明']);
    [
      ['样品类型与计划周', '类型填新品或老产品。类型、计划周留空时继承导入窗口中的选择；周列可填“待排期”。计划周填任一天会归到周一，与客户交期独立。'],
      ['单套计划工时', '单位为分钟/套，最多三位小数。总工时=单套分钟数×数量；12.5 分钟×24 套=5 小时。留空标记工时待补，更新已有计划时留空保留原工时。'],
      ['订单与更新', '来源订单号与订单行区分真实业务批次；更新原计划可填样品计划编号，在预览中选择更新并填写原因。已完成计划通过更正入口处理。'],
      ['下达日期与预警', '计划下达日期可填；历史日期不清楚时留空，系统显示未记录，不推测补填。提前预警天数为 0 至 30 的整数，留空默认 2 天。'],
      ['前 6 列', '必填：客户名称、产品名称、型号/规格、客户等级、样品数量、计划日期。'],
      ['客户等级', '只能填写 A、B、C、D；系统固定显示为 A红、B黄、C蓝、D绿。'],
      ['图纸库编号', '选填。已明确知道图纸库编号时填写，可精确复用；留空时系统按客户和型号/规格自动匹配。'],
      ['匹配结果', '唯一精确匹配直接复用；没有匹配自动新建；相似但不唯一时上传预览会要求人工确认。'],
      ['重复数据', '疑似重复行会提示人工选择更新、跳过或新建独立批次。同一来源订单行不允许重复创建；不同真实批次请填写不同订单号/行号。'],
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
