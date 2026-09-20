import ExcelJS from 'exceljs';
import { firstTime, type FirstActivity } from './quality-first-types';
import { qualityResponsibilityLabel } from './process-quality-report';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { prisma } from '@/lib/prisma';
import { getObjectStream } from '@/lib/s3';
import { safeFilename } from '@/lib/validation';
import { CONTEXT_FIELDS, isPaperArchive, QUALITY_DATA_TYPES, QUALITY_LABELS, RESULT_LABELS, REVIEW_LABELS, beijingInput, QualityDataError, type QualityRecord } from '@/lib/quality-data';

export async function qualityWorkbook(records: (QualityRecord & { activity?: FirstActivity })[], filter: string) {
  const book = new ExcelJS.Workbook();
  book.creator = '杭连协同平台';
  const overview = book.addWorksheet('记录清单');
  overview.addRow(['质量数据导出', '北京时间', beijingInput().replace('T',' ')]);
  overview.addRow(['查询条件', filter]);
  const headings = ['记录编号','检验类型','标题','检验时间','提交时间','订单号','订单行','生产批次','工单号','产品','规格','客户','检验结论','记录状态','复核状态','填写人','版本','作废原因','摘要','来源','工序序号','报工单位','责任人','报工记录ID', ...CONTEXT_FIELDS.map(([, label]) => label), '首次上传时间', '最近上传时间', '最近上传人', '最近变更时间'];
  overview.addRow(headings);
  for (const r of records) {
    const o = r.orderSnapshot;
    overview.addRow([r.code,QUALITY_LABELS[r.type],r.title,beijingInput(r.inspectedAt).replace('T',' '),r.submittedAt ? beijingInput(r.submittedAt).replace('T',' ') : '',o.sourceOrderNo,o.sourceLineNo,o.batchNo,o.businessCode || o.code,o.productName,o.specification,o.customerName,isPaperArchive(r) ? '纸质报表归档' : r.sourceCompletionId && r.result === 'PASS' ? '未发现不良' : RESULT_LABELS[r.result],r.deletedAt ? '已作废' : r.status === 'DRAFT' ? '草稿' : '已提交',REVIEW_LABELS[r.reviewStatus],r.createdByName,r.version,r.deleteReason,r.data.summary,r.sourceCompletionId ? '工序报工' : r.supersedesId ? '复检' : '独立检验',r.inspectionStepSnapshot?.position || r.reportSnapshot?.position,r.reportSnapshot?.unit,qualityResponsibilityLabel(r.responsibility,Number(r.data.context.defectQty||0)),r.sourceCompletionId,...CONTEXT_FIELDS.map(([key]) => r.data.context[key]), r.activity?.firstUploadedAt ? firstTime(r.activity.firstUploadedAt) : '', r.activity?.lastUploadedAt ? firstTime(r.activity.lastUploadedAt) : '', r.activity?.lastUploadedAt ? r.activity.uploadedBy : '', firstTime(r.updatedAt)]);
  }
  for (const type of QUALITY_DATA_TYPES) {
    const sheet = book.addWorksheet(QUALITY_LABELS[type]);
    sheet.addRow(['记录编号','工单号','订单号','生产批次','检验时间','样本编号','位置 / 线号','检验项目','标准 / 依据','下限','上限','实测 / 检查结果','单位','判定','备注','来源','检验总数','不良数量','责任人']);
    for (const r of records.filter(item => item.type === type)) {
      if (r.sourceCompletionId) {
        sheet.addRow([r.code,r.orderSnapshot.businessCode || r.orderSnapshot.code,r.orderSnapshot.sourceOrderNo,r.orderSnapshot.batchNo,beijingInput(r.inspectedAt).replace('T',' '),'',`第 ${r.reportSnapshot?.position} 道`,r.reportSnapshot?.processName,'','','','',r.reportSnapshot?.unit,r.result === 'PASS' ? '未发现不良' : RESULT_LABELS[r.result],r.data.summary,'工序报工',r.reportSnapshot?.quantity,r.reportSnapshot?.defectQty,qualityResponsibilityLabel(r.responsibility,Number(r.data.context.defectQty||0))]);
      }
      if (r.data.mode === 'FILE' && !r.data.rows.length) {
        sheet.addRow([r.code,r.orderSnapshot.businessCode || r.orderSnapshot.code,r.orderSnapshot.sourceOrderNo,r.orderSnapshot.batchNo,beijingInput(r.inspectedAt).replace('T',' '),'',r.inspectionStepSnapshot ? '第 ' + r.inspectionStepSnapshot.position + ' 道' : r.data.paper?.area || '',r.inspectionStepSnapshot?.name || r.title,'','','',r.attachments.filter(f => !f.deletedAt).length + ' 份照片 / 文件','',isPaperArchive(r) ? '纸质报表归档' : RESULT_LABELS[r.result],r.data.summary,'纸质凭证']);
      }
      for (const row of r.data.rows) {
      sheet.addRow([r.code,r.orderSnapshot.businessCode || r.orderSnapshot.code,r.orderSnapshot.sourceOrderNo,r.orderSnapshot.batchNo,beijingInput(r.inspectedAt).replace('T',' '),row.sample,row.position,row.item,row.standard,row.lower,row.upper,row.value,row.unit,RESULT_LABELS[row.result],row.note]);
      }
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
export async function paperWorkbook(records: (QualityRecord & { activity?: FirstActivity })[], filter: string) {
  const book = new ExcelJS.Workbook(); book.creator = '杭连协同平台';
  const sheet = book.addWorksheet('日期报表');
  sheet.addRow(['查询条件', filter]);
  sheet.addRow(['记录编号', '类型', '报表名称', '报表开始日期', '报表结束日期', '状态', '附件数量', '首次上传', '最近上传', '最近上传人', '归档时间', '最近变更', '实际检验人', '区域', '备注', '历史来源工单', '历史检验结果']);
  for (const r of records) sheet.addRow([r.code, r.type === 'FIRST' ? '首检报表' : '巡检报表', r.title, beijingInput(r.inspectedAt).slice(0,10), r.data.paper?.dateEnd || beijingInput(r.inspectedAt).slice(0,10), r.deletedAt ? '已作废' : r.status === 'SUBMITTED' ? '已归档' : '草稿', r.attachments.filter(f => !f.deletedAt).length, firstTime(r.activity?.firstUploadedAt), firstTime(r.activity?.lastUploadedAt), r.activity?.uploadedBy || '', firstTime(r.submittedAt), firstTime(r.updatedAt), r.data.context.inspectedBy || '', r.data.paper?.area || '', r.data.summary, r.workOrderId ? r.orderSnapshot.businessCode || r.orderSnapshot.code : '', r.workOrderId ? RESULT_LABELS[r.result] : '']);
  const files = book.addWorksheet('照片清单'); files.addRow(['记录编号', '照片名称', '上传时间', '状态', 'SHA-256']);
  for (const r of records) for (const file of r.attachments) files.addRow([r.code, file.originalName, firstTime(file.createdAt), file.deletedAt ? '已移除' : '有效', file.sha256]);
  for (const s of book.worksheets) { const row = s === sheet ? 2 : 1; s.views = [{ state:'frozen', ySplit:row }]; s.autoFilter = { from: { row, column:1 }, to:{ row:s.rowCount, column:s.columnCount } }; s.columns.forEach(c => c.width=23); s.getRow(row).eachCell(c => { c.font={bold:true,color:{argb:'FFFFFFFF'}}; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD5630C'}}; }); }
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function qualityZip(records: QualityRecord[], filter: string, paper = false) {
  // Use exactly the attachments in the exported record snapshots, including
  // files concurrently soft-deleted after those snapshots were read.
  const attachmentIds = records.flatMap(record => record.attachments.filter(file => !file.deletedAt).map(file => file.id));
  const files = await prisma.qualityDataAttachment.findMany({ where: { id: { in: attachmentIds } }, orderBy: { createdAt: 'asc' } });
  if (files.length !== attachmentIds.length) throw new QualityDataError('附件清单发生变化，请重新查询后导出', 409);
  if (files.length > 500 || files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new QualityDataError('附件超过 500 个或 200 MB，请缩小范围后打包', 413);
  const zip = new ZipFile(), output = zip.outputStream as Readable;
  zip.on('error', error => output.destroy(error));
  zip.addBuffer(await (paper ? paperWorkbook(records, filter) : qualityWorkbook(records, filter)), '质量数据及附件清单.xlsx');
  const byId = new Map(records.map(record => [record.id, record]));
  for (const file of files) {
    const record = byId.get(file.recordId)!;
    const folder = safeFilename(record.type === 'FIRST' || record.type === 'PATROL' ? (record.type === 'FIRST' ? '首检报表-' : '巡检报表-') + beijingInput(record.inspectedAt).slice(0,10) : record.orderSnapshot.sourceOrderNo || record.orderSnapshot.code) + '/' + record.code;
    zip.addReadStreamLazy(folder + '/' + String(record.attachments.filter(f => !f.deletedAt).findIndex(f => f.id === file.id) + 1).padStart(2,'0') + '-' + file.id.slice(0,8) + '-' + safeFilename(file.originalName), { size: file.size, compress: false }, callback => {
      getObjectStream(file.objectKey).then(stream => callback(null, stream)).catch(error => { output.destroy(error); callback(error, Readable.from([])); });
    });
  }
  zip.end();
  return output;
}
