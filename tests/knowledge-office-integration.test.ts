import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { saveKnowledgeArticle, removeKnowledgeAttachment } from '../lib/knowledge-write';
import { searchKnowledge } from '../lib/knowledge-search';

test('file-only knowledge saves atomically and protects attachments across edits, deletes and concurrent saves', { skip: process.env.RUN_DB_INTEGRATION !== '1' }, async t => {
  const marker = 'KBQ-' + randomUUID().slice(0, 8);
  const actor = await prisma.user.create({ data: { username: marker, displayName: '知识验收', passwordHash: 'not-a-login-hash' } });
  const other = await prisma.user.create({ data: { username: marker + '-other', displayName: '其他人员', passwordHash: 'not-a-login-hash' } });
  const stage = (name = marker + '.xls', owner = actor.id) => prisma.knowledgeAttachment.create({ data: {
    objectKey: `test/${randomUUID()}`, originalName: name, mimeType: 'application/vnd.ms-excel', fileType: 'xls', size: 20n, uploadedById: owner,
  } });
  try {
    await t.test('empty content and unowned, nonexistent or deleted files cannot create a published article', async () => {
      const file = await stage('other.xls', other.id);
      const count = await prisma.knowledgeArticle.count();
      await assert.rejects(saveKnowledgeArticle({ title: marker, content: '' }, actor.id), /知识内容或上传/);
      await assert.rejects(saveKnowledgeArticle({ title: marker, content: '', attachmentIds: [file.id] }, actor.id), /不属于/);
      await assert.rejects(saveKnowledgeArticle({ title: marker, attachmentIds: ['not-a-file'] }, actor.id));
      assert.equal(await prisma.knowledgeArticle.count(), count);
    });
    const files = [await stage(), await stage(marker + '.doc')];
    let article = (await saveKnowledgeArticle({ title: '附件独立入库 ' + marker, content: '', attachmentIds: files.map(f => f.id) }, actor.id)).article;
    await t.test('two attachments create a file-only article and filename search finds it', async () => {
      assert.equal(article.content, ''); assert.equal(article.status, 'published'); assert.equal(article.attachments.length, 2);
      const results = await searchKnowledge({ source: 'article', keyword: marker + '.xls', category: 'all', limit: 60 });
      assert.ok(results.some(row => row.sourceId === article.id));
    });
    await t.test('removing one file is allowed, removing the last file is blocked until body is provided', async () => {
      const updated = await removeKnowledgeAttachment(files[0].id, actor.id);
      assert.ok(updated); article = updated;
      await assert.rejects(removeKnowledgeAttachment(files[1].id, actor.id), /最后一个附件/);
      assert.ok((await prisma.knowledgeAttachment.findUniqueOrThrow({ where: { id: files[0].id } })).deletedAt);
      article = (await saveKnowledgeArticle({ version: article.version, content: '补充了处理步骤' }, actor.id, article.id)).article;
      await removeKnowledgeAttachment(files[1].id, actor.id);
      assert.equal(await prisma.knowledgeAttachment.count({ where: { articleId: article.id, deletedAt: null } }), 0);
      assert.ok((await prisma.knowledgeAttachment.findUniqueOrThrow({ where: { id: files[1].id } })).objectKey);
    });
    await t.test('stale article edits keep staged files unbound and preserve the winning text', async () => {
      const extra = await stage();
      const current = await prisma.knowledgeArticle.findUniqueOrThrow({ where: { id: article.id } });
      const input = { version: current.version, content: '并发更新' };
      const results = await Promise.allSettled([
        saveKnowledgeArticle(input, actor.id, article.id),
        saveKnowledgeArticle({ ...input, attachmentIds: [extra.id] }, actor.id, article.id),
      ]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      const file = await prisma.knowledgeAttachment.findUniqueOrThrow({ where: { id: extra.id } });
      assert.equal(file.articleId === article.id, results[1].status === 'fulfilled');
    });
    await t.test('a staged file cannot be consumed by two new articles', async () => {
      const file = await stage();
      const body = { title: marker + ' 并发附件', attachmentIds: [file.id] };
      const before = await prisma.knowledgeArticle.count();
      const result = await Promise.allSettled([saveKnowledgeArticle(body, actor.id), saveKnowledgeArticle(body, actor.id)]);
      assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(await prisma.knowledgeArticle.count(), before + 1);
    });
    await t.test('cancelled staged uploads are soft deleted by their owner only', async () => {
      const file = await stage();
      await assert.rejects(removeKnowledgeAttachment(file.id, other.id));
      await removeKnowledgeAttachment(file.id, actor.id);
      await assert.rejects(saveKnowledgeArticle({ title: marker, attachmentIds: [file.id] }, actor.id));
    });
  } finally { await prisma.$disconnect(); }
});
