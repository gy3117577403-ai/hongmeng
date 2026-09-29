// Only isolated acceptance databases; never run against a business database.
const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { randomUUID, createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');
if (process.env.REVIEW_QA_ALLOW !== 'disposable-review-runtime') throw Error('Disposable runtime required');
const db = new PrismaClient();
async function main() {
  const marker = 'review-qa-' + randomUUID().slice(0, 8), password = 'Review-Smoke-2026!Z', users = {};
  for (const [role, name, scopes] of [
    ['tech', '技术复核验收', ['MODULE:technology:COLLABORATE', 'MODULE:quality:READ']],
    ['supervisor', '主管复核验收', ['MODULE:quality:COLLABORATE']],
    ['quality', '品质复核验收', ['MODULE:quality:COLLABORATE']],
    ['reader', '只读复核验收', ['MODULE:quality:READ', 'MODULE:technology:READ']],
  ]) {
    const user = await db.user.create({ data: { username: marker + '-' + role, displayName: name, passwordHash: await bcrypt.hash(password, 10),
      laborRole: 'EMPLOYEE', isActive: true, accountStatus: 'ACTIVE', mustChangePassword: false,
      accessGrants: { create: ['MODULES:ON', ...scopes].map(scopeKey => ({ profile: 'MODULE_ACCESS', scopeKey })) } } });
    users[role] = { id: user.id, username: user.username, name };
  }
  const settings = { ownerId: users.tech.id, supervisorIds: [users.supervisor.id], qualityIds: [users.quality.id], technicalIds: [users.tech.id] };
  await db.qfSettings.upsert({ where: { id: 'quality-fixtures' }, create: settings, update: settings });
  const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]), font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('DOCUMENT REVIEW ACCEPTANCE', { x: 40, y: 760, size: 20, font, color: rgb(.1, .2, .3) });
  page.drawText('Drawing / SOP - controlled test evidence', { x: 40, y: 720, size: 13, font });
  page.drawRectangle({ x: 80, y: 410, width: 420, height: 230, borderWidth: 3, borderColor: rgb(.2, .4, .6) });
  const bytes = Buffer.from(await pdf.save()), sha = createHash('sha256').update(bytes).digest('hex');
  const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION || 'auto', forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  const product = await db.drawingLibraryItem.create({ data: { libraryKey: marker, specification: marker + '-GHXS-JZGX-0024', customerName: '复核流程验收客户', productName: '高压线束', fixtureRequired: false } });
  const files = {};
  for (const code of ['drawing', 'sop']) {
    const category = await db.resourceCategory.upsert({ where: { code }, update: {}, create: { code, name: code === 'drawing' ? '原图' : 'SOP', sortOrder: 0 } });
    const objectKey = marker + '/' + code + '.pdf';
    await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: objectKey, Body: bytes, ContentType: 'application/pdf' }));
    files[code] = await db.drawingLibraryFile.create({ data: { libraryItemId: product.id, categoryId: category.id, originalName: code + '.pdf', version: 'V1.0',
      mimeType: 'application/pdf', size: bytes.length, objectKey, sha256: sha, uploadedById: users.tech.id } });
  }
  const evidence = f => ({ id: f.id, name: f.originalName, objectKey: f.objectKey, version: f.version, mimeType: f.mimeType, sha256: f.sha256 });
  const values = { libraryItemId: product.id, revision: 'V1.0', needFixture: false, drawingFiles: [evidence(files.drawing)], sopFiles: [evidence(files.sop)], bomRows: [], createdById: users.tech.id };
  const first = await db.qfPackage.create({ data: { ...values, sequence: 1, status: 'RETURNED', submittedById: users.tech.id, submittedByName: users.tech.name, submittedAt: new Date() } });
  const second = await db.qfPackage.create({ data: { ...values, sequence: 2, status: 'REVIEWING', submittedById: users.tech.id, submittedByName: users.tech.name, submittedAt: new Date() } });
  const draft = await db.qfPackage.create({ data: { ...values, sequence: 3 } });
  const issue = await db.qfDocumentReturn.create({ data: { libraryItemId: product.id, sourcePackageId: first.id, submittedPackageId: second.id,
    kind: 'package', fileSnapshot: { name: '历史整包退回', version: 'V1.0' }, reason: 'SOP 跟工艺流程不明确', reviewRole: 'QUALITY', returnedById: users.quality.id,
    returnedByName: users.quality.name, status: 'REVIEWING', responseMode: 'EXPLAIN', responseText: '已补充技术说明并核对流程', respondedById: users.tech.id, respondedByName: users.tech.name, respondedAt: new Date() } });
  const order = await db.workOrder.create({ data: { code: marker + '-WO', specification: product.specification, customerName: product.customerName, productName: product.productName,
    stage: 'frontend', drawingLibraryItemId: product.id, documentReviewRequired: true, planActive: true, weekStartDate: new Date('2026-09-28T00:00:00+08:00') } });
  return { marker, password, users, product, files, oldPackageId: second.id, draftId: draft.id, issueId: issue.id, orderId: order.id, pdfBase64: bytes.toString('base64') };
}
main().then(result => console.log(JSON.stringify(result))).finally(() => db.$disconnect());
