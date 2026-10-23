import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../lib/prisma';
import { ensureKnowledgePreview, readableKnowledgePreview, processKnowledgePreview, readPreviewObject, readKnowledgePreviewSheet, readKnowledgePreviewPage } from '../lib/knowledge-preview';
import * as XLSX from 'xlsx';
import { putObject, deleteObjectsBestEffort } from '../lib/s3';
import { saveKnowledgeArticle } from '../lib/knowledge-write';

test('Office previews use real storage and converter, preserve originals and recover historical files', { skip: process.env.RUN_OFFICE_INTEGRATION !== '1', timeout: 240000 }, async t => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith('_ci'), 'disposable CI database required');
  const id = randomUUID();
  const user = await prisma.user.create({ data: { username: `preview-${id}`, displayName: '预览验收', passwordHash: 'synthetic-test-user' } });
  const article = await prisma.knowledgeArticle.create({ data: { title: `预览验收 ${id}`, content: '保留原件', createdById: user.id } });
  const originals: string[] = [];
  const createFile = async (type: string) => {
    const bytes = readFileSync(new URL(`./fixtures/knowledge-office/knowledge.${type}`, import.meta.url));
    const objectKey = `preview-qa/${id}/${randomUUID()}.${type}`; originals.push(objectKey);
    await putObject({ key: objectKey, body: bytes, contentType: 'application/octet-stream', originalName: `knowledge.${type}` });
    const file = await prisma.knowledgeAttachment.create({ data: { articleId: article.id, objectKey, originalName: `knowledge.${type}`, fileType: type, mimeType: 'application/octet-stream', size: BigInt(bytes.length), uploadedById: user.id } });
    return { file, bytes };
  };
  try {
    await t.test('old failed Excel regenerates and regional reads search beyond the first chunk without exposing storage keys', async () => {
      const { file } = await createFile('xlsx');
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['型号', '数量'], ...Array.from({ length: 2200 }, (_, i) => [`CODE-${String(i).padStart(6, '0')}`, i])]), '采购表');
      const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
      await putObject({ key: file.objectKey, body: bytes, contentType: 'application/octet-stream', originalName: file.originalName });
      await ensureKnowledgePreview(file.id);
      await prisma.knowledgeAttachmentPreview.update({ where: { attachmentId: file.id }, data: { rendererVersion: 'office-v1', status: 'failed', tableStatus: 'failed', tableError: '旧范围上限' } });
      await ensureKnowledgePreview(file.id); await processKnowledgePreview();
      const first = await readKnowledgePreviewPage(file.id, 0, 1);
      assert.equal(first.rows.length, 100); assert.equal(first.totalRows, 2201);
      assert.equal('chunks' in first, false); assert.equal('objectKey' in first, false);
      const found = await readKnowledgePreviewPage(file.id, 0, 1, 'CODE-002199');
      assert.equal(found.rows[0].index, 2201); assert.equal(found.rows[0].cells[1], '2199');
      const last = await readKnowledgePreviewPage(file.id, 0, 999);
      assert.equal(last.rows.at(-1)?.index, 2201);
      assert.equal(createHash('sha256').update(await readPreviewObject(file.objectKey)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    });
    await t.test('four old attachment formats are lazily converted once and original bytes stay identical', async () => {
      for (const type of ['xls', 'xlsx', 'doc', 'docx']) {
        const { file, bytes } = await createFile(type);
        assert.equal(await prisma.knowledgeAttachmentPreview.findUnique({ where: { attachmentId: file.id } }), null);
        await Promise.all([ensureKnowledgePreview(file.id), ensureKnowledgePreview(file.id)]);
        const workers = await Promise.all([processKnowledgePreview(), processKnowledgePreview()]);
        assert.equal(workers.filter(result => result.processed).length, 1, 'concurrent workers claim one document only');
        const preview = await readableKnowledgePreview(file.id);
        assert.equal(preview.pdfStatus, 'ready', preview.pdfError || 'PDF required');
        const pdf = await PDFDocument.load(await readPreviewObject(preview.pdfKey!)); assert.ok(pdf.getPageCount() >= 1);
        if (type.startsWith('xls')) {
          assert.equal(preview.tableStatus, 'ready', preview.tableError || 'table required');
          assert.ok((await readKnowledgePreviewSheet(file.id, 0)).rows.length);
        }
        assert.equal(createHash('sha256').update(await readPreviewObject(file.objectKey)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
        const again = await ensureKnowledgePreview(file.id); assert.equal(again.pdfKey, preview.pdfKey); assert.equal(again.attempts, 1);
      }
    });
    await t.test('newly saved uploads queue automatically without waiting for conversion', async () => {
      const { file } = await createFile('docx');
      await prisma.knowledgeAttachment.update({ where: { id: file.id }, data: { articleId: null } });
      const saved = await saveKnowledgeArticle({ title: '新上传预览 ' + id, attachmentIds: [file.id] }, user.id);
      assert.equal(saved.article.content, '');
      const preview = await prisma.knowledgeAttachmentPreview.findUniqueOrThrow({ where: { attachmentId: file.id } });
      assert.equal(preview.status, 'pending'); await processKnowledgePreview();
      assert.equal((await readableKnowledgePreview(file.id)).pdfStatus, 'ready');
    });
    await t.test('converter outage leaves Excel table readable and manual retry recovers the PDF', async () => {
      const { file } = await createFile('xlsx'); await ensureKnowledgePreview(file.id);
      const configured = process.env.OFFICE_PREVIEW_URL;
      try { process.env.OFFICE_PREVIEW_URL = 'http://127.0.0.1:1'; await processKnowledgePreview(); }
      finally { process.env.OFFICE_PREVIEW_URL = configured; }
      const partial = await readableKnowledgePreview(file.id);
      assert.equal(partial.tableStatus, 'ready'); assert.equal(partial.pdfStatus, 'failed');
      await Promise.all([ensureKnowledgePreview(file.id, true), ensureKnowledgePreview(file.id, true)]);
      await processKnowledgePreview(); const recovered = await readableKnowledgePreview(file.id);
      assert.equal(recovered.pdfStatus, 'ready', recovered.pdfError || 'retry required');
      assert.deepEqual(recovered.sheets, partial.sheets, 'retry preserves an already usable table');
    });
    await t.test('expired worker leases recover; deleted attachments never expose cached derivatives', async () => {
      const { file } = await createFile('doc'); await ensureKnowledgePreview(file.id);
      await prisma.knowledgeAttachmentPreview.update({ where: { attachmentId: file.id }, data: { status: 'processing', attempts: 1, leaseToken: 'interrupted', leaseUntil: new Date(0) } });
      await processKnowledgePreview(); const ready = await readableKnowledgePreview(file.id); assert.equal(ready.pdfStatus, 'ready'); assert.equal(ready.attempts, 2);
      await prisma.knowledgeAttachment.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
      await assert.rejects(readableKnowledgePreview(file.id), /不存在/); await assert.rejects(ensureKnowledgePreview(file.id), /不存在/);
      assert.ok((await readPreviewObject(file.objectKey)).length, 'soft deletion preserves original storage');
    });
    await t.test('source and renderer changes invalidate caches, staged files cannot be read', async () => {
      const { file } = await createFile('docx'); await ensureKnowledgePreview(file.id); await processKnowledgePreview();
      await prisma.knowledgeAttachmentPreview.update({ where: { attachmentId: file.id }, data: { rendererVersion: 'old-renderer' } });
      await assert.rejects(readableKnowledgePreview(file.id), /不存在/);
      const queued = await ensureKnowledgePreview(file.id); assert.equal(queued.status, 'pending'); assert.equal(queued.pdfKey, null);
      await processKnowledgePreview();
      await prisma.knowledgeAttachment.update({ where: { id: file.id }, data: { articleId: null } });
      await assert.rejects(readableKnowledgePreview(file.id), /不存在/); await assert.rejects(ensureKnowledgePreview(file.id), /不存在/);
    });
  } finally {
    const files = await prisma.knowledgeAttachment.findMany({ where: { uploadedById: user.id }, include: { preview: true } });
    const keys = files.flatMap(file => [file.preview?.pdfKey, ...((file.preview?.sheets || []) as { objectKey: string }[]).map(sheet => sheet.objectKey)]).filter((key): key is string => !!key);
    const chunkKeys: string[] = [];
    for (const file of files) for (const sheet of (file.preview?.sheets || []) as { objectKey: string }[]) {
      const manifest = JSON.parse((await readPreviewObject(sheet.objectKey)).toString('utf8'));
      chunkKeys.push(...(manifest.chunks || []).map((chunk: { objectKey: string }) => chunk.objectKey));
    }
    await deleteObjectsBestEffort([...originals, ...keys, ...chunkKeys]);
    await prisma.knowledgeAttachment.deleteMany({ where: { uploadedById: user.id } });
    await prisma.knowledgeArticle.deleteMany({ where: { createdById: user.id } });
    await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect();
  }
});
