import assert from 'node:assert/strict';
import test from 'node:test';
import { knowledgeArticleSnapshot, parseKnowledgeArticleInput } from '../lib/knowledge';

test('knowledge article input validates required fields and enums', () => {
  const valid = parseKnowledgeArticleInput({
    title: '压接端子首件确认方法',
    content: '确认拉力、压接高度和外观后再放行。',
    category: 'inspection',
    status: 'published',
  });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.data.category, 'inspection');
  assert.equal(valid.data.status, 'published');

  const invalid = parseKnowledgeArticleInput({ title: '', content: '', category: 'invalid', status: 'unknown' });
  assert.deepEqual(invalid.errors, ['请输入知识标题', '请输入知识内容', '知识分类不正确', '知识状态不正确']);
});

test('knowledge input trims and deduplicates tags and relations', () => {
  const parsed = parseKnowledgeArticleInput({
    title: '  裁线注意事项  ',
    content: '  先核对线径和长度。  ',
    category: 'process',
    status: 'draft',
    tags: ['裁线', ' 裁线 ', '首件'],
    relations: [
      { sourceType: 'drawing', sourceId: 'drawing-1', sourceLabel: '原图', sourceHref: '/drawing-library?itemId=drawing-1' },
      { sourceType: 'drawing', sourceId: 'drawing-1', sourceLabel: '重复原图' },
      { sourceType: 'manual', sourceId: 'manual-1', sourceHref: 'javascript:alert(1)' },
      { sourceType: 'parameter', sourceId: 'parameter-1', sourceHref: '//outside.example/path' },
      { sourceType: 'article', sourceId: 'article-1' },
      { sourceType: 'invalid', sourceId: 'invalid-1' },
    ],
  });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.data.tags, ['裁线', '首件']);
  assert.equal(parsed.data.relations?.length, 3);
  assert.equal(parsed.data.relations?.[0]?.sourceId, 'drawing-1');
  assert.equal(parsed.data.relations?.[0]?.sourceHref, '/drawing-library?itemId=drawing-1');
  assert.equal(parsed.data.relations?.[1]?.sourceHref, null);
  assert.equal(parsed.data.relations?.[2]?.sourceHref, null);
});

test('partial knowledge updates do not require untouched fields', () => {
  const parsed = parseKnowledgeArticleInput({ summary: '更新后的现场摘要' }, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.data.summary, '更新后的现场摘要');
  assert.equal(parsed.data.title, undefined);
  assert.equal(parsed.data.content, undefined);
});

test('knowledge snapshot keeps audit fields without credentials or attachments', () => {
  const deletedAt = new Date('2026-07-17T00:00:00.000Z');
  const snapshot = knowledgeArticleSnapshot({
    id: 'article-1',
    title: '包装检验要点',
    category: 'packaging',
    status: 'archived',
    summary: null,
    content: '核对标签和数量。',
    tags: ['包装'],
    customerName: null,
    specification: 'SPEC-001',
    productModel: null,
    version: 3,
    deletedAt,
  });
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.deletedAt, deletedAt);
  assert.equal(Object.hasOwn(snapshot, 'attachments'), false);
  assert.equal(Object.hasOwn(snapshot, 'password'), false);
});
