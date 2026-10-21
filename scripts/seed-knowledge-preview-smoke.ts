import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { ZipFile } from 'yazl';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { putObject } from '../lib/s3';

async function main() {
  assert.equal(process.env.OFFICE_QA_ALLOW, 'disposable-office-runtime');
  assert.ok(/_(ci|mirror)$/.test(new URL(process.env.DATABASE_URL!).pathname));
  const dir = path.resolve(process.env.OFFICE_QA_OUTPUT || 'output/playwright/knowledge-preview-local'); mkdirSync(dir, { recursive: true });
  const marker = 'OPQ-' + randomUUID().slice(0, 8), password = 'Disposable-Office-2026!';
  const department = await prisma.department.upsert({ where: { code: 'PRODUCTION' }, create: { code: 'PRODUCTION', name: '生产部' }, update: {} });
  const user = await prisma.user.create({ data: { username: marker, displayName: '知识预览验收', passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false,
    accessGrants: { create: { profile: 'ADMIN_GLOBAL', departmentId: department.id, scopeKey: 'GLOBAL:' + marker } } } });
  const picture = await sharp(Buffer.from('<svg width="200" height="80"><rect width="200" height="80" rx="12" fill="#fff0de"/><rect x="15" y="20" width="55" height="40" fill="#ef6a16"/><path d="M70 40 H180" stroke="#26344a" stroke-width="8"/></svg>')).png().toBuffer();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('物料配套');
  sheet.columns = [{ width: 18 }, { width: 28 }, { width: 12 }, { width: 24 }, { width: 24 }, { width: 16 }, { width: 16 }];
  sheet.addRow(['物料编码', '物料名称', '数量', '长编码', '需求日期']);
  sheet.addRow([123, 'HVSL 高压连接器', 5, '12345678901234567890', new Date(Date.UTC(2026, 9, 21))]);
  sheet.getCell('A2').numFmt = '000000'; sheet.getCell('E2').numFmt = 'yyyy-mm-dd';
  sheet.addRow(['MOLEX-001', '端子', 12, '合并单元格演示']); sheet.addRow(['', '配套壳体', 8]); sheet.mergeCells('A3:A4');
  sheet.addRow(['公式数量', { formula: 'C2*2', result: 10 }, '已保存结果']);
  sheet.addRow(['测试文字', '<script>alert("not executable")</script>', '=SUM(1,2)']);
  const img = workbook.addImage({ base64: picture.toString('base64'), extension: 'png' }); sheet.addImage(img, { tl: { col: 5, row: 1 }, ext: { width: 200, height: 80 } });
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, printArea: 'A1:H12' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE56B18' } };
  const second = workbook.addWorksheet('替代型号'); second.addRows([['原型号', '替代型号'], ['HVSL-01', 'MOLEX-02']]);
  const long = workbook.addWorksheet('大表分页'); long.addRow(['序号', '型号', '数量']);
  for (let i = 1; i <= 1205; i++) long.addRow([i, `HVSL-${String(i).padStart(4, '0')}`, i % 12]);
  long.pageSetup = { paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  workbook.addWorksheet('隐藏工作表', { state: 'hidden' }).addRow(['隐藏内容不应展示']);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  const zip = new ZipFile();
  const add = (name: string, value: string | Buffer) => zip.addBuffer(Buffer.isBuffer(value) ? value : Buffer.from(value), name);
  add('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  add('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  add('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="img1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/diagram.png"/></Relationships>');
  add('word/media/diagram.png', picture);
  add('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
    <w:p><w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t>连接器装配经验</w:t></w:r></w:p>
    <w:p><w:r><w:t>中文技术资料：检查端子型号、压接尺寸与安装方向。Office preview acceptance.</w:t></w:r></w:p>
    <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:bottom w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>型号 HVSL-001</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量 5 件</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="762000"/><wp:docPr id="1" name="装配示意"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="diagram.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="img1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>第二页：验证记录与注意事项</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  const docxPromise = new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; zip.outputStream.on('data', chunk => chunks.push(chunk)); zip.outputStream.on('end', () => resolve(Buffer.concat(chunks))); zip.outputStream.on('error', reject); }); zip.end();
  const documents = { xlsx, docx: await docxPromise, xls: readFileSync(path.resolve('tests/fixtures/knowledge-office/knowledge.xls')), doc: readFileSync(path.resolve('tests/fixtures/knowledge-office/knowledge.doc')) };
  const article = await prisma.knowledgeArticle.create({ data: { title: `${marker} 历史 Office 附件`, content: '历史附件无需重新上传', createdById: user.id } });
  const files: { id: string; type: string; name: string; hash: string; path: string }[] = [];
  for (const [type, bytes] of Object.entries(documents)) {
    const name = `${marker}-知识资料.${type}`; const filename = path.join(dir, name); writeFileSync(filename, bytes);
    const objectKey = `knowledge/qa/${marker}/${name}`;
    await putObject({ key: objectKey, body: bytes, contentType: 'application/octet-stream', originalName: name });
    const file = await prisma.knowledgeAttachment.create({ data: { articleId: article.id, objectKey, originalName: name, fileType: type, mimeType: 'application/octet-stream', size: BigInt(bytes.length), uploadedById: user.id } });
    files.push({ id: file.id, type, name, path: filename.replaceAll('\\', '/'), hash: createHash('sha256').update(bytes).digest('hex') });
  }
  assert.equal(await prisma.knowledgeAttachmentPreview.count({ where: { attachmentId: { in: files.map(file => file.id) } } }), 0);
  writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ marker, password, user: { username: user.username }, articleId: article.id, files }, null, 2));
  console.log('Isolated legacy Office fixtures saved; no preview cache pre-created.');
}
main().finally(() => prisma.$disconnect());
