'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseProcessReportDraft, PROCESS_REPORT_DRAFT_PREFIX, processReportDraftKey, type ProcessReportDraft } from '@/lib/process-report-draft';

export type ProcessReportResponse = {
  ok?: boolean;
  pending?: boolean;
  error?: string;
  code?: string;
  canSubmitPending?: boolean;
  submission?: { id: string; status: string; reasonCode?: string; reasonLabel?: string; assigneeNames?: string[] };
  data?: Record<string, any>;
};

export class ProcessReportRequestError extends Error {
  constructor(message: string, public code = '', public status = 0, public canSubmitPending = false, public uncertain = false) { super(message); }
}

const memoryDrafts = new Map<string, string>();
const inFlight = new Set<string>();
const ACTIVE_OWNER_KEY = 'hm:process-report:active-owner';

export function useProcessReportDraft<T>(ownerId: string, scopePrefix: string, onRecovered: (body: ProcessReportResponse, draft: ProcessReportDraft<T>) => void) {
  const [queued, setQueued] = useState<ProcessReportDraft<T>[]>([]);
  const [notice, setNotice] = useState('');
  const [recovering, setRecovering] = useState(false);
  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;

  const read = useCallback((scope: string): ProcessReportDraft<T> | null => {
    const key = processReportDraftKey(ownerId, scope);
    let raw = memoryDrafts.get(key) || null;
    try { raw = localStorage.getItem(key) || raw; } catch { /* Private browsing can reject storage. */ }
    return parseProcessReportDraft<T>(raw, ownerId, scope);
  }, [ownerId]);

  const refreshQueue = useCallback(() => {
    const keys = new Set(memoryDrafts.keys());
    try { for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (key?.startsWith(PROCESS_REPORT_DRAFT_PREFIX)) keys.add(key); } } catch { /* Use this tab's copy. */ }
    const items: ProcessReportDraft<T>[] = [];
    for (const key of keys) {
      let raw = memoryDrafts.get(key) || null;
      try { raw = localStorage.getItem(key) || raw; } catch { /* Use this tab's copy. */ }
      const draft = parseProcessReportDraft<T>(raw, ownerId);
      if (draft?.request && draft.scope.startsWith(scopePrefix)) items.push(draft);
    }
    setQueued(items.sort((a, b) => a.savedAt - b.savedAt));
    return items;
  }, [ownerId, scopePrefix]);

  const write = useCallback((draft: ProcessReportDraft<T>) => {
    const key = processReportDraftKey(ownerId, draft.scope);
    const raw = JSON.stringify(draft);
    memoryDrafts.set(key, raw);
    try { localStorage.setItem(key, raw); }
    catch { setNotice('此浏览器不能保存本机草稿，请保持页面打开；当前输入仍在本页保留。'); }
  }, [ownerId]);

  const save = useCallback((scope: string, value: T, idempotencyKey: string) => {
    if (!ownerId || !scope || !idempotencyKey) return;
    const previous = read(scope);
    // A sent request is frozen until the server gives a definite answer.
    if (previous?.request) return;
    write({ version: 1, ownerId, scope, value, idempotencyKey, savedAt: Date.now() });
  }, [ownerId, read, write]);

  const clear = useCallback((scope: string) => {
    const key = processReportDraftKey(ownerId, scope);
    memoryDrafts.delete(key);
    try { localStorage.removeItem(key); } catch { /* No persisted copy. */ }
    refreshQueue();
  }, [ownerId, refreshQueue]);

  const send = useCallback(async (scope: string, value: T, idempotencyKey: string, endpoint: string, body: Record<string, unknown>): Promise<ProcessReportResponse> => {
    const key = processReportDraftKey(ownerId, scope);
    if (inFlight.has(key)) throw new ProcessReportRequestError('这笔报工正在核对结果，请稍候。', 'REPORT_REQUEST_IN_FLIGHT');
    try {
      if (localStorage.getItem(ACTIVE_OWNER_KEY) !== ownerId) throw new ProcessReportRequestError('登录账号已切换，请重新打开页面后核对。', 'ACCOUNT_CHANGED', 409);
    } catch (error) { if (error instanceof ProcessReportRequestError) throw error; }
    const previous = read(scope);
    const draft: ProcessReportDraft<T> = previous?.request ? previous : {
      version: 1, ownerId, scope, value, idempotencyKey, savedAt: Date.now(),
      request: { endpoint, body: { ...body, idempotencyKey, expectedUserId: ownerId } },
    };
    write(draft);
    refreshQueue();
    inFlight.add(key);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(draft.request!.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft.request!.body), signal: controller.signal });
      const result = await response.json().catch(() => null) as ProcessReportResponse | null;
      if (!result || response.status >= 500 || (response.ok && (!result.ok || (result.pending ? !result.submission?.id : !result.data)))) throw new ProcessReportRequestError('结果尚未确认，本机已保留待上传记录；联网后会用同一编号核对，请勿另建一笔。', result?.code, response.status, false, true);
      if (!response.ok || !result.ok) {
        if (previous?.request && ([401, 403, 404].includes(response.status) || ['ACCOUNT_CHANGED', 'FIELD_REPORT_READ_ONLY'].includes(result.code || ''))) {
          throw new ProcessReportRequestError(`${result.error || '当前无法读取这笔报工结果'}。原请求仍保留，请恢复原账号后核对，不要另建报工。`, result.code, response.status, false, true);
        }
        write({ ...draft, request: undefined, savedAt: Date.now() });
        refreshQueue();
        throw new ProcessReportRequestError(result.error || '报工暂未受理，输入已保留。', result.code, response.status, result.canSubmitPending);
      }
      clear(scope);
      return result;
    } catch (error) {
      if (error instanceof ProcessReportRequestError) throw error;
      throw new ProcessReportRequestError('本机待上传，服务端结果尚未确认。网络恢复后会用同一编号续传，请保留此页面或重新打开核对。', 'REPORT_NETWORK_UNCERTAIN', 0, false, true);
    } finally { window.clearTimeout(timeout); inFlight.delete(key); refreshQueue(); }
  }, [ownerId, read, write, clear, refreshQueue]);

  const retryQueued = useCallback(async () => {
    if (!navigator.onLine) return;
    setRecovering(true);
    try {
      for (const draft of refreshQueue()) {
        if (!draft.request || inFlight.has(processReportDraftKey(ownerId, draft.scope))) continue;
        try {
          const result = await send(draft.scope, draft.value, draft.idempotencyKey, draft.request.endpoint, draft.request.body);
          onRecoveredRef.current(result, draft);
          setNotice('已核对本机待上传记录，请查看受理结果。');
        } catch (error) { setNotice(error instanceof Error ? error.message : '待上传记录仍在本机保留。'); }
      }
    } finally { setRecovering(false); }
  }, [ownerId, refreshQueue, send]);

  useEffect(() => {
    try { localStorage.setItem(ACTIVE_OWNER_KEY, ownerId); } catch { /* Session still verified by the API. */ }
    void retryQueued();
    const online = () => { void retryQueued(); };
    window.addEventListener('online', online);
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith(PROCESS_REPORT_DRAFT_PREFIX)) {
        if (event.newValue) memoryDrafts.set(event.key, event.newValue); else memoryDrafts.delete(event.key);
        refreshQueue();
      }
    };
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('online', online); window.removeEventListener('storage', storage); };
  }, [ownerId, retryQueued, refreshQueue]);

  return { read, save, clear, send, queued, notice, recovering, retryQueued };
}
