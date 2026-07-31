import type {
  PublishSopInput,
  SaveDraftInput,
  SopApiAdapter,
  SopAsset,
  SopVersion,
  SopWorkspace,
} from './types';

type JsonRecord = Record<string, unknown>;

async function responsePayload(response: Response): Promise<JsonRecord> {
  return response.json().catch(() => ({})) as Promise<JsonRecord>;
}

function errorText(payload: JsonRecord, fallback: string): string {
  return typeof payload.error === 'string' ? payload.error : typeof payload.message === 'string' ? payload.message : fallback;
}

function unwrap<T>(payload: JsonRecord, keys: string[]): T {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key] as T;
  }
  if (payload.data && typeof payload.data === 'object') {
    const nested = payload.data as JsonRecord;
    for (const key of keys) {
      if (nested[key] !== undefined) return nested[key] as T;
    }
    return nested as T;
  }
  return payload as T;
}

async function requestJson<T>(fetcher: typeof fetch, url: string, init?: RequestInit, fallback = 'SOP 请求失败'): Promise<T> {
  const response = await fetcher(url, { credentials: 'same-origin', ...init });
  const payload = await responsePayload(response);
  if (!response.ok) {
    const error = new Error(errorText(payload, fallback));
    Object.assign(error, { status: response.status, payload });
    throw error;
  }
  return payload as T;
}

export function createSopApiAdapter(itemId: string, fetcher: typeof fetch = fetch): SopApiAdapter {
  const itemRoot = `/api/drawing-library/${encodeURIComponent(itemId)}/sop`;

  return {
    async load() {
      const payload = await requestJson<JsonRecord>(fetcher, itemRoot, undefined, '加载 SOP 失败');
      return unwrap<SopWorkspace>(payload, ['workspace', 'sop']);
    },

    async saveDraft(input: SaveDraftInput) {
      const updating = Boolean(input.versionId);
      const url = updating ? `${itemRoot}/versions/${encodeURIComponent(input.versionId || '')}` : `${itemRoot}/draft`;
      const payload = await requestJson<JsonRecord>(fetcher, url, {
        method: updating ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          content: input.content,
          expectedRevision: input.expectedRevision,
        }),
      }, '保存 SOP 草稿失败');
      return unwrap<SopVersion>(payload, ['version', 'draft']);
    },

    async uploadAsset(file: File, versionId?: string) {
      const body = new FormData();
      body.append('file', file);
      if (versionId) body.append('versionId', versionId);
      const payload = await requestJson<JsonRecord>(fetcher, `${itemRoot}/assets/upload`, { method: 'POST', body }, '上传 SOP 图片失败');
      return unwrap<SopAsset>(payload, ['asset']);
    },

    async deleteAsset(assetId: string) {
      await requestJson<JsonRecord>(fetcher, `/api/drawing-library/sop-assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }, '删除 SOP 图片失败');
    },

    async publish(input: PublishSopInput) {
      const body = new FormData();
      body.append('versionId', input.versionId);
      body.append('expectedRevision', String(input.expectedRevision));
      body.append('title', input.title);
      body.append('pdf', input.pdf, `${input.title || 'SOP'}.pdf`);
      const payload = await requestJson<JsonRecord>(fetcher, `${itemRoot}/publish`, { method: 'POST', body }, '发布 SOP 失败');
      return unwrap<SopWorkspace>(payload, ['workspace', 'sop']);
    },

    async restore(versionId: string) {
      const payload = await requestJson<JsonRecord>(fetcher, `${itemRoot}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' }, '恢复 SOP 历史版本失败');
      return unwrap<SopVersion>(payload, ['version', 'draft']);
    },

    async deleteDraft(versionId: string, expectedRevision: number) {
      await requestJson<JsonRecord>(fetcher, `${itemRoot}/versions/${encodeURIComponent(versionId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision }),
      }, '删除 SOP 草稿失败');
    },
  };
}
