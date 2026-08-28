'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { documentDisplaySettingsUrl, rotateDocumentPages, samePageRotations, type PageRotations } from '@/lib/document-orientation';

type Cached = { revision: number; saved: PageRotations; draft: PageRotations; page: number };
const sessions = new Map<string, Cached>();
const leaveGuards = new Set<(action: () => void) => boolean>();
let replaying = false;

/** All programmatic file/category changes run through this gate before changing selection. */
export function requestPreviewLeave(action: () => void): void {
  if (!replaying) for (const guard of leaveGuards) if (guard(action)) return;
  action();
}

export function useDocumentOrientation(source: string) {
  const url = documentDisplaySettingsUrl(source);
  const key = url || source.split('?')[0];
  const cached = sessions.get(key);
  const [saved, setSaved] = useState<PageRotations>(cached?.saved || {});
  const [draft, setDraft] = useState<PageRotations>(cached?.draft || {});
  const [revision, setRevision] = useState(cached?.revision || 0);
  const [page, setPage] = useState(cached?.page || 1);
  const [canSave, setCanSave] = useState(false);
  const [ready, setReady] = useState(!url);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const state = useRef({ draft, saved, revision, canSave, saving });
  state.current = { draft, saved, revision, canSave, saving };
  const rootRef = useRef<HTMLDivElement>(null);
  const dirty = !samePageRotations(saved, draft);

  async function load(discard = false) {
    if (!url) return;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '方向设置读取失败');
      setSaved(data.pageRotations);
      setRevision(data.revision);
      setCanSave(data.canSave === true);
      setDraft(!discard && cached && cached.revision === data.revision ? cached.draft : data.pageRotations);
      setReady(true);
      setMessage(discard ? '已恢复服务器保存的方向' : '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '方向设置读取失败');
    }
  }

  useEffect(() => { void load(); /* source identity is the keyed viewer boundary */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    sessions.set(key, { revision, saved, draft, page });
    if (sessions.size > 150) sessions.delete(sessions.keys().next().value as string);
  }, [draft, key, page, ready, revision, saved]);

  useEffect(() => {
    const entryUrl = window.location.href;
    const entryState = window.history.state;
    const guard = (action: () => void) => {
      const current = state.current;
      if (!current.canSave || samePageRotations(current.saved, current.draft)) return false;
      pending.current = action;
      setPrompt(true);
      return true;
    };
    leaveGuards.add(guard);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (state.current.canSave && !samePageRotations(state.current.saved, state.current.draft)) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    const back = (event: PopStateEvent) => {
      const destination = window.location.href;
      if (replaying || !state.current.canSave || samePageRotations(state.current.saved, state.current.draft)) return;
      event.stopImmediatePropagation();
      window.history.pushState(entryState, '', entryUrl);
      guard(() => window.location.assign(destination));
    };
    const link = (event: MouseEvent) => {
      if (replaying || !(event.target instanceof Element) || rootRef.current?.contains(event.target)) return;
      const target = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!target || target.target === '_blank' || target.hasAttribute('download') || event.ctrlKey || event.metaKey || event.button !== 0) return;
      if (guard(() => { replaying = true; try { target.click(); } finally { replaying = false; } })) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', back, true);
    document.addEventListener('click', link, true);
    return () => { leaveGuards.delete(guard); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', back, true); document.removeEventListener('click', link, true); };
  }, []);

  async function save(): Promise<boolean> {
    if (!url || !canSave || saving) return false;
    setSaving(true); setMessage('');
    try {
      const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, pageRotations: draft }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '方向保存失败');
      setRevision(data.revision); setSaved(data.pageRotations); setDraft(data.pageRotations);
      sessions.set(key, { revision: data.revision, saved: data.pageRotations, draft: data.pageRotations, page });
      state.current = { ...state.current, draft: data.pageRotations, saved: data.pageRotations, revision: data.revision };
      setMessage('方向已保存，所有有查看权限的人员均可使用');
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '方向保存失败，请重试'); return false;
    } finally { setSaving(false); }
  }

  function continueNavigation(discard: boolean) {
    if (discard) {
      setDraft(saved); state.current = { ...state.current, draft: saved };
      sessions.set(key, { revision, saved, draft: saved, page });
    }
    setPrompt(false);
    const action = pending.current; pending.current = null;
    if (action) { replaying = true; try { action(); } finally { replaying = false; } }
  }

  return {
    key, url, ready, rootRef, page, setPage, draft, saved, revision, canSave, dirty, saving, message, prompt,
    save, reload: () => load(true),
    rotate: (delta: number, pageCount = 1, all = false) => { if (!saving) { setMessage(''); setDraft(value => rotateDocumentPages(value, page, delta, pageCount, all)); } },
    restoreOriginal: () => { if (!saving) { setMessage(''); setDraft(value => { const next = { ...value }; delete next[page]; return next; }); } },
    cancel: () => { pending.current = null; setPrompt(false); },
    discardAndLeave: () => continueNavigation(true),
    saveAndLeave: async () => { if (await save()) continueNavigation(false); },
  };
}

export type DocumentOrientationController = ReturnType<typeof useDocumentOrientation>;

export function DocumentOrientationControls({ orientation: o, pageCount = 1, disabled = false }: { orientation: DocumentOrientationController; pageCount?: number; disabled?: boolean }) {
  const [all, setAll] = useState(false);
  const blocked = disabled || o.saving || !o.ready;
  return <div className="document-orientation-controls" role="group" aria-label="文件阅读方向">
    <button type="button" aria-label="向左旋转" title="向左旋转 90°" disabled={blocked} onClick={() => o.rotate(-90, pageCount, all)}>↺</button>
    <button type="button" aria-label="向右旋转" title="向右旋转 90°" disabled={blocked} onClick={() => o.rotate(90, pageCount, all)}>↻</button>
    {o.url && <button type="button" className={o.dirty && o.canSave ? 'orientation-save dirty' : 'orientation-save'} disabled={blocked || !o.canSave || !o.dirty} title={o.canSave ? '保存为该文件的公共默认方向' : '只读账号可临时旋转，不能保存公共方向'} onClick={() => void o.save()}>{o.saving ? '保存中…' : '保存方向'}</button>}
    <details className="viewer-more"><summary aria-label="方向设置">方向</summary><div>
      {pageCount > 1 && <label className="orientation-page-scope"><input type="checkbox" checked={all} disabled={blocked} onChange={event => setAll(event.target.checked)} />本次旋转应用到全部 {pageCount} 页</label>}
      <button type="button" disabled={blocked} onClick={o.restoreOriginal}>恢复当前页原文件方向</button>
      {o.url && <button type="button" disabled={o.saving} onClick={() => void o.reload()}>恢复服务器已保存方向</button>}
      {o.url && <a href={`${o.url}?download=1`} target="_blank" rel="noreferrer">按已保存方向导出</a>}
      <span>{o.canSave ? '保存后对有查看权限的人员生效' : '临时旋转仅影响本次浏览'}</span>
    </div></details>
    {o.dirty && <small className="orientation-dirty">{o.canSave ? '方向未保存' : '临时方向'}</small>}
  </div>;
}

export function DocumentPreviewFrame({ orientation: o, fullscreen, title, onClose, children }: { orientation: DocumentOrientationController; fullscreen: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const confirmRef = useRef<HTMLElement>(null);
  const controllerRef = useRef(o);
  controllerRef.current = o;
  useEffect(() => {
    if (!o.prompt) return;
    const previous = document.activeElement;
    const dialog = confirmRef.current;
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!controllerRef.current.saving) controllerRef.current.cancel(); }
      if (event.key !== 'Tab' || !dialog) return;
      const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    return () => { document.removeEventListener('keydown', trap, true); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [o.prompt]);
  useEffect(() => {
    if (!fullscreen) return;
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !o.prompt) onClose(); };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [fullscreen, o.prompt, onClose]);
  return <div ref={o.rootRef} className={`document-preview-session${fullscreen ? ' preview-fullscreen-backdrop' : ''}`} role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen || undefined} aria-label={fullscreen ? `${title} 全屏预览` : undefined}>
    <div className={fullscreen ? 'document-preview-panel preview-fullscreen-panel' : 'document-preview-panel'}>
      {o.ready ? children : <div className="viewer-state"><strong>正在读取文件方向…</strong><button type="button" onClick={() => void o.reload()}>重新读取</button></div>}
      {o.message && <div className="orientation-message" role="status">{o.message}</div>}
    </div>
    {o.prompt && <div className="orientation-confirm-backdrop"><section ref={confirmRef} className="orientation-confirm" role="alertdialog" aria-modal="true" aria-labelledby="orientation-confirm-title">
      <h3 id="orientation-confirm-title">是否保存阅读方向？</h3><p>{title} 的阅读方向已修改。保存后对所有有查看权限的人员生效。</p>
      {o.message && <p role="alert">{o.message}</p>}
      <footer><button type="button" disabled={o.saving} onClick={o.cancel}>取消</button><button type="button" disabled={o.saving} onClick={o.discardAndLeave}>不保存并切换</button><button autoFocus type="button" className="primary-button" disabled={o.saving} onClick={() => void o.saveAndLeave()}>{o.saving ? '保存中…' : '保存并切换'}</button></footer>
    </section></div>}
  </div>;
}
