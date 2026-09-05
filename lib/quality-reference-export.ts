import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { prisma } from './prisma';
import { getObjectStream } from './s3';
import { safeFilename } from './validation';
import { beijingInput, QualityDataError } from './quality-data';
import { REFERENCE_SOURCE, REFERENCE_STATUS, type QualityReference } from './quality-reference';
export async function referenceWorkbook(records: QualityReference[]) {
  const book=new ExcelJS.Workbook();book.creator='杭连协同平台';
  const sheet=book.addWorksheet('端子参考参数');
  sheet.addRow(['方案编号','端子型号','厂家','方案名称','状态','版本','线材','规格数值','规格单位','绝缘 / 并线说明','机台','模具','参数分类','参数名称','参考数值','单位 / 刻度','公差说明','参数备注','资料来源','依据','验证人','验证时间','备注','创建人','更新时间','删除原因']);
  for(const r of records)for(const p of r.data.parameters)sheet.addRow([r.code,r.terminalName,r.manufacturer,r.title,REFERENCE_STATUS[r.status],r.version,r.data.wire,r.data.wireSize,r.data.wireUnit,r.data.insulation,r.data.equipment,r.data.mold,p.group==='DIMENSION'?'压接尺寸':'机器设定',p.name,p.value,p.unit,p.tolerance,p.note,REFERENCE_SOURCE[r.data.source],r.data.basis,r.data.verifiedBy,r.data.verifiedAt,r.data.remark,r.createdByName,beijingInput(r.updatedAt).replace('T',' '),r.deleteReason]);
  const files=book.addWorksheet('附件清单');files.addRow(['方案编号','文件名','字节数','SHA-256','状态']);
  for(const r of records)for(const f of r.attachments)files.addRow([r.code,f.originalName,f.size,f.sha256,f.deletedAt?'已移除':'有效']);
  for(const s of book.worksheets){s.views=[{state:'frozen',ySplit:1}];s.autoFilter={from:{row:1,column:1},to:{row:s.rowCount,column:s.columnCount}};s.columns.forEach(c=>{c.width=22;});s.getRow(1).eachCell(c=>{c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFB45309'}};});}
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function referenceZip(records: QualityReference[]) {
  const ids=records.flatMap(r=>r.attachments.filter(f=>!f.deletedAt).map(f=>f.id));
  const files=await prisma.qualityReferenceAttachment.findMany({where:{id:{in:ids}}});
  if(files.length!==ids.length)throw new QualityDataError('附件清单已变化，请重试',409);
  if(files.length>500||files.reduce((n,f)=>n+f.size,0)>200*1024*1024)throw new QualityDataError('附件超过 500 个或 200 MB，请缩小范围',413);
  const zip=new ZipFile(),output=zip.outputStream as Readable;
  zip.on('error',e=>output.destroy(e));zip.addBuffer(await referenceWorkbook(records),'端子参考数据.xlsx');
  const map=new Map(records.map(r=>[r.id,r]));
  for(const f of files){const r=map.get(f.referenceId)!;zip.addReadStreamLazy(safeFilename(r.terminalName)+'/'+r.code+'/'+f.id.slice(0,8)+'-'+safeFilename(f.originalName),{size:f.size,compress:false},callback=>{getObjectStream(f.objectKey).then(stream=>callback(null,stream)).catch(error=>{output.destroy(error);callback(error,Readable.from([]));});});}
  zip.end();return output;
}
