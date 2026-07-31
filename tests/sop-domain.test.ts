import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SOP_MAX_DEPTH,
  SopRequestError,
  assertCommonDrawingFileLifecycleAllowed,
  assertExpectedRevision,
  assertMutableDraft,
  collectSopAssetIds,
  isOnlineGeneratedSopFile,
  isSopReadyFromPublishedVersion,
  nextDrawingLibraryMinorVersion,
  onlineGeneratedSopFileIdsToArchive,
  parseExpectedRevision,
  validateSopContent,
  type SopDocumentContent,
} from '../lib/sop';
import {
  assertSopAssetsAvailable,
  assertDraftDeleteRevision,
  cleanSopTitle,
  defaultSopTitle,
  loadSopWorkspaceByItemId,
} from '../lib/sop/server';

function documentWith(content: unknown[]): unknown {
  return { type: 'doc', schemaVersion: 1, content };
}

function requestError(error: unknown): SopRequestError {
  assert.ok(error instanceof SopRequestError);
  return error;
}

test('SOP schema accepts supported rich content and strips unknown attributes', () => {
  const content = validateSopContent(documentWith([
    {
      type: 'heading',
      attrs: { level: 2, align: 'center', ignored: 'not persisted' },
      content: [{ type: 'text', text: '装配作业指导书', marks: [{ type: 'bold' }] }],
    },
    {
      type: 'paragraph',
      attrs: { variant: 'warning', indent: 2, ignored: true },
      content: [{
        type: 'text',
        text: '仅使用安全链接',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/sop', ignored: 'x' } }],
      }],
    },
    {
      type: 'image',
      attrs: {
        assetId: 'asset_12345678',
        alt: '压接位置',
        widthPercent: 60,
        align: 'right',
        objectKey: 'must-not-leak',
      },
    },
    {
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '检查项' }] }] }],
      }],
    },
  ]));

  assert.deepEqual(content.content[0].attrs, { level: 2, align: 'center' });
  assert.deepEqual(content.content[1].attrs, { variant: 'warning', indent: 2 });
  assert.deepEqual(content.content[2].attrs, {
    assetId: 'asset_12345678', alt: '压接位置', widthPercent: 60, align: 'right',
  });
  assert.deepEqual(content.content[1].content?.[0].marks?.[0], {
    type: 'link', attrs: { href: 'https://example.com/sop' },
  });
});

test('SOP schema rejects executable links and malformed document trees', () => {
  assert.throws(
    () => validateSopContent(documentWith([{
      type: 'paragraph',
      content: [{ type: 'text', text: '危险链接', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
    }])),
    /仅支持安全/,
  );
  assert.throws(() => validateSopContent(documentWith([{ type: 'script', content: [] }])), /不支持/);
  assert.throws(() => validateSopContent(documentWith([{ type: 'doc', content: [] }])), /不能嵌套 doc/);
  assert.throws(() => validateSopContent(documentWith([{ type: 'text', text: 'x', content: [] }])), /文字节点不能包含子节点/);
  assert.throws(
    () => validateSopContent(documentWith([{ type: 'bulletList', content: [{ type: 'paragraph', content: [] }] }])),
    /列表中只能包含列表项/,
  );
  assert.throws(
    () => validateSopContent(documentWith([{ type: 'table', content: [{ type: 'paragraph', content: [] }] }])),
    /表格中只能包含表格行/,
  );
});

test('SOP schema enforces image identity and nesting limits', () => {
  assert.throws(
    () => validateSopContent(documentWith([{ type: 'image', attrs: { assetId: '../object-key' } }])),
    /图片素材标识无效/,
  );

  let nested: unknown = { type: 'paragraph', content: [] };
  for (let index = 0; index <= SOP_MAX_DEPTH; index += 1) {
    nested = { type: 'listItem', content: [nested] };
  }
  assert.throws(() => validateSopContent(documentWith([nested])), /嵌套不能超过/);
});

test('asset references are unique and all must belong to the active SOP document', async () => {
  const content = validateSopContent(documentWith([
    { type: 'image', attrs: { assetId: 'asset_valid_001' } },
    { type: 'paragraph', content: [{ type: 'image', attrs: { assetId: 'asset_valid_001' } }] },
    { type: 'image', attrs: { assetId: 'asset_missing_02' } },
  ]));
  assert.deepEqual(collectSopAssetIds(content), ['asset_valid_001', 'asset_missing_02']);

  let receivedQuery: unknown;
  const tx = {
    sopAsset: {
      findMany: async (query: unknown) => {
        receivedQuery = query;
        return [{ id: 'asset_valid_001' }];
      },
    },
  };
  await assert.rejects(
    () => assertSopAssetsAvailable(tx as never, 'document-a', content),
    error => {
      const actual = requestError(error);
      assert.equal(actual.status, 409);
      assert.equal(actual.code, 'SOP_ASSET_UNAVAILABLE');
      assert.deepEqual(actual.detail, { assetIds: ['asset_missing_02'] });
      return true;
    },
  );
  assert.deepEqual(receivedQuery, {
    where: {
      id: { in: ['asset_valid_001', 'asset_missing_02'] },
      documentId: 'document-a',
      deletedAt: null,
    },
    select: { id: true },
  });
});

test('asset validation performs no query for image-free SOP content', async () => {
  let queried = false;
  const tx = { sopAsset: { findMany: async () => { queried = true; return []; } } };
  const ids = await assertSopAssetsAvailable(
    tx as never,
    'document-a',
    validateSopContent(documentWith([{ type: 'paragraph', content: [{ type: 'text', text: '纯文字' }] }])) as SopDocumentContent,
  );
  assert.deepEqual(ids, []);
  assert.equal(queried, false);
});

test('optimistic revision parsing and conflicts expose a stable 409 contract', () => {
  assert.equal(parseExpectedRevision(0), 0);
  assert.equal(parseExpectedRevision('17'), 17);
  for (const value of ['', '-1', '1.2', null, undefined]) {
    assert.throws(() => parseExpectedRevision(value), /非负整数/);
  }
  assert.doesNotThrow(() => assertExpectedRevision(4, 4));
  assert.throws(
    () => assertExpectedRevision(5, 4),
    error => {
      const actual = requestError(error);
      assert.equal(actual.status, 409);
      assert.equal(actual.code, 'SOP_REVISION_CONFLICT');
      assert.deepEqual(actual.detail, { expectedRevision: 4, actualRevision: 5 });
      return true;
    },
  );
});

test('draft deletion requires an explicit matching expected revision', () => {
  assert.equal(assertDraftDeleteRevision(7, { expectedRevision: 7 }), 7);
  assert.equal(assertDraftDeleteRevision(7, {}, '7'), 7);
  assert.throws(
    () => assertDraftDeleteRevision(7, {}),
    error => {
      const actual = requestError(error);
      assert.equal(actual.status, 400);
      assert.equal(actual.code, 'SOP_INVALID_REQUEST');
      return true;
    },
  );
  assert.throws(
    () => assertDraftDeleteRevision(7, { lockVersion: 7 }),
    error => requestError(error).code === 'SOP_INVALID_REQUEST',
  );
  assert.throws(
    () => assertDraftDeleteRevision(7, { expectedRevision: 6 }),
    error => {
      const actual = requestError(error);
      assert.equal(actual.status, 409);
      assert.equal(actual.code, 'SOP_REVISION_CONFLICT');
      assert.deepEqual(actual.detail, { expectedRevision: 6, actualRevision: 7 });
      return true;
    },
  );
});

test('published or soft-deleted versions are immutable', () => {
  assert.doesNotThrow(() => assertMutableDraft({ status: 'draft', deletedAt: null }));
  assert.throws(
    () => assertMutableDraft({ status: 'published', deletedAt: null }),
    error => requestError(error).code === 'SOP_PUBLISHED_IMMUTABLE',
  );
  assert.throws(
    () => assertMutableDraft({ status: 'draft', deletedAt: new Date() }),
    error => requestError(error).code === 'SOP_DRAFT_DELETED',
  );
});

test('published online SOP files are distinguishable from manually uploaded SOP files', () => {
  assert.equal(isOnlineGeneratedSopFile({ sourceSopVersionId: 'version-1' }), true);
  assert.equal(isOnlineGeneratedSopFile({ sourceSopVersionId: null }), false);
  assert.equal(isOnlineGeneratedSopFile({}), false);
  assert.equal(nextDrawingLibraryMinorVersion(['V1.0', 'v1.4', 'V2.0', null]), 'V1.5');
  assert.equal(nextDrawingLibraryMinorVersion([]), 'V1.0');
});

test('common file lifecycle preserves manual files and rejects generated SOP files', () => {
  for (const action of ['update', 'delete', 'restore'] as const) {
    assert.doesNotThrow(() => assertCommonDrawingFileLifecycleAllowed({ sourceSopVersionId: null }, action));
    assert.doesNotThrow(() => assertCommonDrawingFileLifecycleAllowed({}, action));
    assert.throws(
      () => assertCommonDrawingFileLifecycleAllowed({ sourceSopVersionId: 'sop-version-1' }, action),
      error => {
        const actual = requestError(error);
        assert.equal(actual.status, 409);
        assert.equal(actual.code, 'SOP_GENERATED_FILE_MANAGED_BY_VERSION');
        assert.deepEqual(actual.detail, { action });
        return true;
      },
    );
  }
});

test('publishing archives only active online-generated SOP files and preserves manual uploads', () => {
  const deletedAt = new Date('2026-08-01T00:00:00.000Z');
  assert.deepEqual(onlineGeneratedSopFileIdsToArchive([
    { id: 'generated-active', sourceSopVersionId: 'version-1', deletedAt: null },
    { id: 'manual-active', sourceSopVersionId: null, deletedAt: null },
    { id: 'manual-legacy', deletedAt: null },
    { id: 'generated-already-deleted', sourceSopVersionId: 'version-0', deletedAt },
  ]), ['generated-active']);
});

test('SOP readiness is derived only from an active published version with an active generated file', () => {
  assert.equal(isSopReadyFromPublishedVersion(null), false);
  assert.equal(isSopReadyFromPublishedVersion({ status: 'draft', deletedAt: null, publishedFile: null }), false);
  assert.equal(isSopReadyFromPublishedVersion({
    status: 'draft',
    deletedAt: null,
    publishedFile: { deletedAt: null },
  }), false, 'an editable draft must never mark the product SOP as ready');
  assert.equal(isSopReadyFromPublishedVersion({
    status: 'published',
    deletedAt: new Date('2026-08-01T00:00:00.000Z'),
    publishedFile: { deletedAt: null },
  }), false);
  assert.equal(isSopReadyFromPublishedVersion({
    status: 'published',
    deletedAt: null,
    publishedFile: { deletedAt: new Date('2026-08-01T00:00:00.000Z') },
  }), false);
  assert.equal(isSopReadyFromPublishedVersion({
    status: 'published',
    deletedAt: null,
    publishedFile: { deletedAt: null },
  }), true);
});

test('SOP titles are normalized without accepting oversized content', () => {
  assert.equal(cleanSopTitle('  压接作业指导书  '), '压接作业指导书');
  assert.equal(cleanSopTitle('  ', '默认标题'), '默认标题');
  assert.throws(() => cleanSopTitle('字'.repeat(161)), /160/);
  assert.equal(defaultSopTitle({ specification: 'GHXS-001', productName: '线束' }), 'GHXS-001 · 线束 SOP');
});

test('workspace exposes publishedVersion only from the document pointer and keeps drafts separate', async () => {
  const createdAt = new Date('2026-08-01T01:00:00.000Z');
  const updatedAt = new Date('2026-08-01T02:00:00.000Z');
  const content = documentWith([{ type: 'paragraph', content: [] }]);
  const versions = [
    {
      id: 'draft-1', documentId: 'document-1', version: 2, revision: 3, status: 'draft', title: '草稿', content,
      contentSchemaVersion: 1, basedOnVersionId: 'published-1', createdBy: null, updatedBy: null, publishedBy: null,
      publishedAt: null, deletedAt: null, createdAt, updatedAt, publishedFile: null,
    },
    {
      id: 'published-1', documentId: 'document-1', version: 1, revision: 4, status: 'published', title: '已发布', content,
      contentSchemaVersion: 1, basedOnVersionId: null, createdBy: null, updatedBy: null, publishedBy: null,
      publishedAt: updatedAt, deletedAt: null, createdAt, updatedAt, publishedFile: null,
    },
  ];
  const client = {
    drawingLibraryItem: {
      findFirst: async () => ({ id: 'item-1', customerName: '客户', productName: '线束', specification: 'GHXS-001', libraryKey: 'key' }),
    },
    sopDocument: {
      findFirst: async () => ({
        id: 'document-1', drawingLibraryItemId: 'item-1', title: '在线 SOP', currentPublishedVersionId: 'published-1',
        createdBy: null, updatedBy: null, createdAt, updatedAt, versions, assets: [],
      }),
    },
  };

  const workspace = await loadSopWorkspaceByItemId(client as never, 'item-1');
  assert.equal(workspace.draft?.id, 'draft-1');
  assert.equal(workspace.publishedVersion?.id, 'published-1');
  assert.equal(workspace.versions.length, 2);
  assert.equal(workspace.publishedVersion?.revision, 4);
});
