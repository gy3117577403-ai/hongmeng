import assert from 'node:assert/strict';
import test from 'node:test';
import { createSopApiAdapter } from '../components/sop/api';
import type { SopDocument, SopWorkspace } from '../components/sop/types';

type CapturedRequest = { url: string; init?: RequestInit };

const document: SopDocument = {
  type: 'doc',
  schemaVersion: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '作业内容' }] }],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function captureFetch(payload: unknown = {}, status = 200) {
  const requests: CapturedRequest[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return jsonResponse(payload, status);
  };
  return { requests, fetcher: fetcher as typeof fetch };
}

test('SOP adapter loads an encoded item route and unwraps the canonical workspace', async () => {
  const workspace = {
    item: { id: 'item/一' },
    document: null,
    draft: null,
    publishedVersion: null,
    versions: [],
    assets: [],
  };
  const { requests, fetcher } = captureFetch({ workspace });
  const result = await createSopApiAdapter('item/一', fetcher).load();

  assert.deepEqual(result, workspace);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/drawing-library/item%2F%E4%B8%80/sop');
  assert.equal(requests[0].init?.credentials, 'same-origin');
});

test('SOP adapter creates and updates drafts with expectedRevision, never a UI-only lockVersion alias', async () => {
  const { requests, fetcher } = captureFetch({ version: { id: 'draft-1' } });
  const adapter = createSopApiAdapter('item-1', fetcher);

  await adapter.saveDraft({ content: document, expectedRevision: 0 } as never);
  await adapter.saveDraft({ versionId: 'draft/一', content: document, expectedRevision: 7 } as never);

  assert.equal(requests[0].url, '/api/drawing-library/item-1/sop/draft');
  assert.equal(requests[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    content: document,
    expectedRevision: 0,
  });
  assert.equal(requests[1].url, '/api/drawing-library/item-1/sop/versions/draft%2F%E4%B8%80');
  assert.equal(requests[1].init?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), {
    content: document,
    expectedRevision: 7,
  });
});

test('SOP adapter uploads images as multipart data scoped to the current item and draft', async () => {
  const { requests, fetcher } = captureFetch({ asset: { id: 'asset-1' } });
  const file = new File([new Uint8Array([1, 2, 3])], '压接位置.png', { type: 'image/png' });
  await createSopApiAdapter('item-1', fetcher).uploadAsset(file, 'draft-1');

  assert.equal(requests[0].url, '/api/drawing-library/item-1/sop/assets/upload');
  assert.equal(requests[0].init?.method, 'POST');
  assert.ok(requests[0].init?.body instanceof FormData);
  const body = requests[0].init?.body as FormData;
  const uploaded = body.get('file');
  assert.ok(uploaded instanceof File);
  assert.equal(uploaded.name, '压接位置.png');
  assert.equal(uploaded.type, 'image/png');
  assert.equal(body.get('versionId'), 'draft-1');
});

test('SOP adapter publishes an immutable PDF with optimistic concurrency fields', async () => {
  const workspace = { draft: null, publishedVersion: { id: 'published-1' }, versions: [], assets: [] } as unknown as SopWorkspace;
  const { requests, fetcher } = captureFetch({ workspace, publishedDrawingLibraryFileId: 'file-1' });
  const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
  const result = await createSopApiAdapter('item-1', fetcher).publish({
    versionId: 'draft-1',
    expectedRevision: 9,
    pdf,
  } as never);

  assert.deepEqual(result, workspace);
  assert.equal(requests[0].url, '/api/drawing-library/item-1/sop/publish');
  assert.equal(requests[0].init?.method, 'POST');
  assert.ok(requests[0].init?.body instanceof FormData);
  const body = requests[0].init?.body as FormData;
  assert.equal(body.get('versionId'), 'draft-1');
  assert.equal(body.get('expectedRevision'), '9');
  const generated = body.get('pdf');
  assert.ok(generated instanceof File);
  assert.equal(generated.type, 'application/pdf');
  assert.match(generated.name, /\.pdf$/i);
});

test('SOP adapter routes asset deletion, draft deletion and history restore without losing credentials', async () => {
  const { requests, fetcher } = captureFetch({ version: { id: 'restored-draft' } });
  const adapter = createSopApiAdapter('item-1', fetcher);

  await adapter.deleteAsset('asset/一');
  await adapter.deleteDraft('draft/一', 7);
  await adapter.restore('published/一');

  assert.deepEqual(requests.map(request => [request.url, request.init?.method, request.init?.credentials]), [
    ['/api/drawing-library/sop-assets/asset%2F%E4%B8%80', 'DELETE', 'same-origin'],
    ['/api/drawing-library/item-1/sop/versions/draft%2F%E4%B8%80', 'DELETE', 'same-origin'],
    ['/api/drawing-library/item-1/sop/versions/published%2F%E4%B8%80/restore', 'POST', 'same-origin'],
  ]);
  assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { expectedRevision: 7 });
});

test('SOP adapter exposes backend status and structured conflict payloads', async () => {
  const payload = {
    error: '文档已被其他人更新，请刷新后合并修改',
    code: 'SOP_REVISION_CONFLICT',
    detail: { expectedRevision: 3, actualRevision: 4 },
  };
  const { fetcher } = captureFetch(payload, 409);

  await assert.rejects(
    () => createSopApiAdapter('item-1', fetcher).load(),
    error => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { status: number }).status, 409);
      assert.deepEqual((error as Error & { payload: unknown }).payload, payload);
      return true;
    },
  );
});
