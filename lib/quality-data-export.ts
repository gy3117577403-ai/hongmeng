import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { safeFilename } from '@/lib/validation';
import { CONTEXT_FIELDS, QUALITY_DATA_TYPES, QUALITY_LABELS, RESULT_LABELS, REVIEW_LABELS, beijingInput, QualityDataError, type QualityRecord } from '@/lib/quality-data';

export async function qualityWorkbook(records: QualityRecord[], filter: string) {
  const book = new ExcelJS.Workbook();
  book.creator = '杭连协同平台';
  const overview = book.addWorksheet('记录清单');
  overview.addRow(['质量数据导出', '北京时间', beijingInput().replace('T',' ')]);
  overview.addRow(['查询条件', filter]);
  const headings = ['记录编号','检验类型','标题','检验时间','提交时间','订单号','订单行','生产批次','工单号','产品','规格','客户','检验结论','记录状态','复核状态','填写人','版本','作废原因','摘要', ...CONTEXT_FIELDS.map(([, label]) => label)];
  overview.addRow(headings);
  for (const r of records) {
    const o = r.orderSnapshot;
    overview.addRow([r.code,QUALITY_LABELS[r.type],r.title,beijingInput(r.inspectedAt).replace('T',' '),r.submittedAt ? beijingInput(r.submittedAt).replace('T',' ') : '',o.sourceOrderNo,o.sourceLineNo,o.batchNo,o.businessCode || o.code,o.productName,o.specification,o.customerName,RESULT_LABELS[r.result],r.deletedAt ? '已作废' : r.status === 'DRAFT' ? '草稿' : '已提交',REVIEW_LABELS[r.reviewStatus],r.createdByName,r.version,r.deleteReason,r.data.summary,...CONTEXT_FIELDS.map(([key]) => r.data.context[key])]);
  }
  for (const type of QUALITY_DATA_TYPES) {
    const sheet = book.addWorksheet(QUALITY_LABELS[type]);
    sheet.addRow(['记录编号','工单号','订单号','生产批次','检验时间','样本编号','位置 / 线号','检验项目','标准 / 依据','下限','上限','实测 / 检查结果','单位','判定','备注']);
    for (const r of records.filter(item => item.type === type)) for (const row of r.data.rows) {
      sheet.addRow([r.code,r.orderSnapshot.businessCode || r.orderSnapshot.code,r.orderSnapshot.sourceOrderNo,r.orderSnapshot.batchNo,beijingInput(r.inspectedAt).replace('T',' '),row.sample,row.position,row.item,row.standard,row.lower,row.upper,row.value,row.unit,RESULT_LABELS[row.result],row.note]);
    }
  }
  const attachments = book.addWorksheet('附件清单');
  attachments.addRow(['记录编号','附件名称','字节数','SHA-256','上传时间','状态']);
  for (const r of records) for (const file of r.attachments) attachments.addRow([r.code,file.originalName,file.size,file.sha256,beijingInput(file.createdAt).replace('T',' '),file.deletedAt ? '已移除' : '有效']);
  for (const sheet of book.worksheets) {
    const header = sheet === overview ? 3 : 1;
    sheet.views = [{ state: 'frozen', ySplit: header }];
    sheet.autoFilter = { from: { row: header, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
    sheet.columns.forEach(column => { column.width = 21; });
    sheet.getRow(header).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } }; });
    sheet.eachRow(row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; }));
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function qualityZip(records: QualityRecord[], filter: string) {
  // Use exactly the attachments in the exported record snapshots, including
  // files concurrently soft-deleted after those snapshots were read.
  const attachmentIds = records.flatMap(record => record.attachments.filter(file => !file.deletedAt).map(file => file.id));
  const files = await prisma.qualityDataAttachment.findMany({ where: { id: { in: attachmentIds } }, orderBy: { createdAt: 'asc' } });
  if (files.length !== attachmentIds.length) throw new QualityDataError('附件清单发生变化，请重新查询后导出', 409);
  if (files.length > 500 || files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new QualityDataError('附件超过 500 个或 200 MB，请缩小范围后打包', 413);
  const zip = new ZipFile(), output = zip.outputStream as Readable;
  zip.on('error', error => output.destroy(error));
  zip.addBuffer(await qualityWorkbook(records, filter), '质量数据及附件清单.xlsx');
  const byId = new Map(records.map(record => [record.id, record]));
  for (const file of files) {
    const record = byId.get(file.recordId)!;
    const folder = safeFilename(record.orderSnapshot.sourceOrderNo || record.orderSnapshot.code) + '/' + record.code;
    zip.addReadStreamLazy(folder + '/' + file.id.slice(0,8) + '-' + safeFilename(file.originalName), { size: file.size, compress: false }, callback => {
      getObjectStream(file.objectKey).then(stream => callback(null, stream)).catch(error => { output.destroy(error); callback(error, Readable.from([])); });
    });
  }
  zip.end();
  return output;
}
