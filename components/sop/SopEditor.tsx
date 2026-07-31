'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenText,
  Check,
  CheckSquare2,
  ChevronRight,
  Cloud,
  CloudOff,
  Eye,
  FileOutput,
  FileText,
  Heading1,
  History,
  ImagePlus,
  ListChecks,
  LoaderCircle,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Send,
  Table2,
  Trash2,
  Type,
  Undo2,
  UploadCloud,
  X,
} from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import { createSopApiAdapter } from './api';
import { createSopPdfBlob } from './pdf';
import styles from './SopEditor.module.css';
import {
  SOP_SCHEMA_VERSION,
  createEmptySopDocument,
  inlineContentFromText,
  listItem,
  normalizeSopDocument,
  paragraph,
  tableCell,
  textFromInlineContent,
} from './types';
import type { SopApiAdapter, SopAsset, SopDocument, SopNode, SopVersion, SopWorkspace } from './types';

type EditorMode = 'edit' | 'published' | 'history';
type InsertKind = 'heading' | 'paragraph' | 'steps' | 'image' | 'table' | 'warning' | 'checklist' | 'pageBreak';
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
type ConfirmAction = 'delete-draft' | 'publish' | null;
type ActiveCommand = 'publishing' | 'restoring' | 'deleting-draft' | null;
type IndexedNode = { node: SopNode; index: number };
type PageModel = { entries: IndexedNode[]; breakBeforeIndex?: number };

export type SopEditorProps = {
  itemId: string;
  productLabel?: string;
  adapter?: SopApiAdapter;
  initialMode?: 'edit' | 'published';
  className?: string;
  onClose?: () => void | Promise<void>;
  onRequestClose?: (result: { saved: boolean; version: SopVersion | null }) => void | Promise<void>;
  onPublished?: (workspace: SopWorkspace) => void;
};

export type SopEditorHandle = {
  /** Waits for any active autosave and persists the newest editor snapshot. */
  flushSave(): Promise<SopVersion | null>;
  /** Flushes the draft, then runs onRequestClose/onClose only when saving succeeded. */
  requestClose(): Promise<boolean>;
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const AUTO_SAVE_DELAY = 1200;
const RECOVERY_PREFIX = 'hongmeng:sop-draft:';

const insertTools: Array<{ kind: InsertKind; label: string; hint: string; icon: ReactNode }> = [
  { kind: 'heading', label: '标题', hint: '章节标题', icon: <Heading1 size={18} /> },
  { kind: 'paragraph', label: '正文', hint: '说明文字', icon: <Type size={18} /> },
  { kind: 'steps', label: '步骤', hint: '编号操作', icon: <ListChecks size={18} /> },
  { kind: 'image', label: '图片', hint: '上传图示', icon: <ImagePlus size={18} /> },
  { kind: 'table', label: '表格', hint: '参数记录', icon: <Table2 size={18} /> },
  { kind: 'warning', label: '警告', hint: '风险提示', icon: <AlertTriangle size={18} /> },
  { kind: 'checklist', label: '检查', hint: '确认清单', icon: <CheckSquare2 size={18} /> },
  { kind: 'pageBreak', label: '分页', hint: '新建 A4 页', icon: <FileText size={18} /> },
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function errorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
}

function cloneDocument(document: SopDocument): SopDocument {
  return typeof structuredClone === 'function'
    ? structuredClone(document)
    : JSON.parse(JSON.stringify(document)) as SopDocument;
}

function documentSignature(document: SopDocument): string {
  return JSON.stringify(document);
}

function nodeText(node: SopNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  return textFromInlineContent(node.content);
}

function listItemText(node: SopNode | undefined): string {
  return nodeText(node?.content?.[0]);
}

function tableCellText(node: SopNode | undefined): string {
  return nodeText(node?.content?.[0]);
}

function createInsertNode(kind: Exclude<InsertKind, 'image'>): SopNode {
  switch (kind) {
    case 'heading':
      return { type: 'heading', attrs: { level: 2 }, content: inlineContentFromText('新章节') };
    case 'paragraph':
      return paragraph('在这里填写作业说明。');
    case 'steps':
      return { type: 'orderedList', attrs: { variant: 'steps' }, content: [listItem('填写第一个作业步骤')] };
    case 'table':
      return {
        type: 'table',
        content: [
          { type: 'tableRow', content: [tableCell('项目', true), tableCell('标准', true), tableCell('记录', true)] },
          { type: 'tableRow', content: [tableCell('作业参数'), tableCell('填写要求'), tableCell('填写结果')] },
        ],
      };
    case 'warning':
      return paragraph('填写必须重点提醒的安全、质量或操作风险。', { variant: 'warning', title: '注意事项' });
    case 'checklist':
      return { type: 'bulletList', attrs: { variant: 'checklist' }, content: [listItem('确认物料与工具准备完成', false)] };
    case 'pageBreak':
      return { type: 'pageBreak' };
  }
}

function paginate(nodes: SopNode[]): PageModel[] {
  const pages: PageModel[] = [{ entries: [] }];
  nodes.forEach((node, index) => {
    if (node.type === 'pageBreak') {
      pages.push({ entries: [], breakBeforeIndex: index });
      return;
    }
    pages[pages.length - 1].entries.push({ node, index });
  });
  return pages;
}

function safeDate(value?: string | null): string {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function versionStatus(version: SopVersion): string {
  if (version.status === 'published') return '已发布';
  return '草稿';
}

function normalizeVersion(version: SopVersion | null | undefined, fallbackTitle?: string): SopVersion | null {
  if (!version?.id) return null;
  return {
    ...version,
    contentSchemaVersion: SOP_SCHEMA_VERSION,
    content: normalizeSopDocument(version.content, fallbackTitle),
  };
}

function normalizeWorkspace(raw: SopWorkspace | null | undefined, itemId: string, fallbackTitle?: string): SopWorkspace {
  const draft = normalizeVersion(raw?.draft, fallbackTitle);
  const publishedVersion = normalizeVersion(raw?.publishedVersion, fallbackTitle);
  const versions = Array.isArray(raw?.versions)
    ? raw.versions.map(version => normalizeVersion(version, fallbackTitle)).filter((version): version is SopVersion => Boolean(version))
    : [];
  const item = raw?.item || {
    id: itemId,
    customerName: '',
    productName: null,
    specification: fallbackTitle || '',
    libraryKey: '',
  };
  return {
    item,
    document: raw?.document || null,
    itemId,
    title: raw?.document?.title || raw?.title || fallbackTitle || 'SOP 作业指导书',
    draft,
    publishedVersion,
    versions,
    assets: Array.isArray(raw?.assets) ? raw.assets.filter(asset => Boolean(asset?.id)) : [],
  };
}

function assetSource(asset?: SopAsset): string {
  return asset?.url || '';
}

function findAsset(assets: SopAsset[], assetId?: string): SopAsset | undefined {
  return assetId ? assets.find(asset => asset.id === assetId) : undefined;
}

function localRecoveryKey(itemId: string): string {
  return `${RECOVERY_PREFIX}${itemId}`;
}

export const SopEditor = forwardRef<SopEditorHandle, SopEditorProps>(function SopEditor(
  { itemId, productLabel, adapter, initialMode = 'edit', className, onClose, onRequestClose, onPublished },
  forwardedRef,
) {
  const api = useMemo(() => adapter || createSopApiAdapter(itemId), [adapter, itemId]);
  const initialDocument = useMemo(() => createEmptySopDocument(productLabel ? `${productLabel} SOP 作业指导书` : undefined), [productLabel]);
  const [workspace, setWorkspace] = useState<SopWorkspace>(() => normalizeWorkspace(undefined, itemId, productLabel));
  const workspaceRef = useRef(workspace);
  const [content, setContent] = useState<SopDocument>(initialDocument);
  const contentRef = useRef(content);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [historyVersion, setHistoryVersion] = useState<SopVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(0);
  const [zoom, setZoom] = useState(82);
  const [uploading, setUploading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand>(null);
  const [recovery, setRecovery] = useState<SopDocument | null>(null);
  const [undoStack, setUndoStack] = useState<SopDocument[]>([]);
  const [redoStack, setRedoStack] = useState<SopDocument[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const exportSurfaceRef = useRef<HTMLDivElement>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const savePromiseRef = useRef<Promise<SopVersion | null> | null>(null);
  const queuedSaveCountRef = useRef(0);
  const dirtyRef = useRef(false);
  const loadedRef = useRef(false);
  const commandRef = useRef<ActiveCommand>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (autoSaveTimerRef.current === null) return;
    window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
  }, []);

  const beginCommand = useCallback((command: Exclude<ActiveCommand, null>): boolean => {
    if (commandRef.current) {
      setMessage('当前操作尚未完成，请稍候');
      return false;
    }
    clearAutoSaveTimer();
    commandRef.current = command;
    setActiveCommand(command);
    return true;
  }, [clearAutoSaveTimer]);

  const endCommand = useCallback(() => {
    commandRef.current = null;
    setActiveCommand(null);
  }, []);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;
    clearAutoSaveTimer();
    commandRef.current = null;
    setActiveCommand(null);
    loadedRef.current = false;
    setLoading(true);
    setMessage('');
    setDirty(false);
    dirtyRef.current = false;
    setSaveState('idle');
    setUndoStack([]);
    setRedoStack([]);
    api.load()
      .then(raw => {
        if (cancelled) return;
        const next = normalizeWorkspace(raw, itemId, productLabel);
        const nextContent = next.draft?.content || next.publishedVersion?.content || initialDocument;
        workspaceRef.current = next;
        setWorkspace(next);
        setContent(nextContent);
        setMode(initialMode === 'published' && next.publishedVersion ? 'published' : 'edit');
        setLastSavedAt(next.draft?.updatedAt ? new Date(next.draft.updatedAt) : null);
        try {
          const stored = window.localStorage.getItem(localRecoveryKey(itemId));
          if (stored) {
            const parsed = JSON.parse(stored) as { content?: unknown };
            const recovered = normalizeSopDocument(parsed.content, productLabel);
            if (documentSignature(recovered) !== documentSignature(nextContent)) setRecovery(recovered);
          }
        } catch {
          window.localStorage.removeItem(localRecoveryKey(itemId));
        }
        loadedRef.current = true;
      })
      .catch(error => {
        if (cancelled) return;
        if (errorStatus(error) === 404) {
          const empty = normalizeWorkspace(undefined, itemId, productLabel);
          workspaceRef.current = empty;
          setWorkspace(empty);
          setContent(initialDocument);
          loadedRef.current = true;
        } else {
          setMessage(errorMessage(error, '加载 SOP 失败'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api, clearAutoSaveTimer, initialDocument, initialMode, itemId, productLabel]);

  const applyDocument = useCallback((next: SopDocument, record = true) => {
    if (commandRef.current) return;
    if (record) {
      setUndoStack(stack => [...stack.slice(-39), cloneDocument(contentRef.current)]);
      setRedoStack([]);
    }
    contentRef.current = next;
    setContent(next);
    setDirty(true);
    dirtyRef.current = true;
    setSaveState('idle');
    setMessage('');
  }, []);

  const undo = useCallback(() => {
    if (commandRef.current) return;
    setUndoStack(stack => {
      const previous = stack[stack.length - 1];
      if (!previous) return stack;
      setRedoStack(current => [...current.slice(-39), cloneDocument(contentRef.current)]);
      contentRef.current = previous;
      setContent(previous);
      setDirty(true);
      dirtyRef.current = true;
      setSaveState('idle');
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    if (commandRef.current) return;
    setRedoStack(stack => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setUndoStack(current => [...current.slice(-39), cloneDocument(contentRef.current)]);
      contentRef.current = next;
      setContent(next);
      setDirty(true);
      dirtyRef.current = true;
      setSaveState('idle');
      return stack.slice(0, -1);
    });
  }, []);

  const saveDraft = useCallback((force = false): Promise<SopVersion | null> => {
    // All callers join one FIFO tail. Autosave, manual save, close and publish can never race revisions.
    queuedSaveCountRef.current += 1;
    const run = async (): Promise<SopVersion | null> => {
      if (!force && !dirtyRef.current) return workspaceRef.current.draft;

      let saved: SopVersion | null = null;
      do {
        const snapshot = cloneDocument(contentRef.current);
        const signature = documentSignature(snapshot);
        const baseDraft = workspaceRef.current.draft;
        setSaveState('saving');

        try {
          const version = await api.saveDraft({
            versionId: baseDraft?.id,
            title: workspaceRef.current.document?.title || workspaceRef.current.title || productLabel || 'SOP 作业指导书',
            content: snapshot,
            expectedRevision: baseDraft?.revision,
          });
          const normalized = normalizeVersion(version, productLabel);
          if (!normalized) throw new Error('保存成功但未返回草稿版本');
          saved = normalized;
          const currentWorkspace = workspaceRef.current;
          const nextWorkspace = {
            ...currentWorkspace,
            draft: normalized,
            versions: [normalized, ...currentWorkspace.versions.filter(item => item.id !== normalized.id)],
          };
          // Update the ref synchronously so a forced second pass uses the revision just returned by the server.
          workspaceRef.current = nextWorkspace;
          setWorkspace(nextWorkspace);
          const unchanged = documentSignature(contentRef.current) === signature;
          if (unchanged) {
            dirtyRef.current = false;
            setDirty(false);
            setSaveState('saved');
            window.localStorage.removeItem(localRecoveryKey(itemId));
          }
          setLastSavedAt(new Date());

          // During a forced flush, immediately persist edits made while this request was in flight.
          if (!force || unchanged) return normalized;
        } catch (error) {
          setSaveState(errorStatus(error) === 409 ? 'conflict' : 'error');
          setMessage(errorMessage(error, '保存 SOP 草稿失败'));
          return null;
        }
      } while (force && dirtyRef.current);
      return saved;
    };

    const operation = saveQueueRef.current.then(run, run).finally(() => {
      queuedSaveCountRef.current = Math.max(0, queuedSaveCountRef.current - 1);
      if (savePromiseRef.current === operation) savePromiseRef.current = null;
    });
    saveQueueRef.current = operation.then(() => undefined, () => undefined);
    savePromiseRef.current = operation;
    return operation;
  }, [api, itemId, productLabel]);

  const flushSave = useCallback(async (): Promise<SopVersion | null> => {
    // Enqueue a final forced pass behind every existing save. It captures content only when its turn starts.
    if (dirtyRef.current || savePromiseRef.current) return saveDraft(true);
    return workspaceRef.current.draft;
  }, [saveDraft]);

  const requestClose = useCallback(async (): Promise<boolean> => {
    if (commandRef.current) {
      setMessage('当前操作尚未完成，请稍候');
      return false;
    }
    const version = await flushSave();
    if (dirtyRef.current) {
      setMessage('当前 SOP 仍有未保存修改，请保存成功后再离开');
      return false;
    }
    if (onRequestClose) await onRequestClose({ saved: true, version });
    else if (onClose) await onClose();
    return true;
  }, [flushSave, onClose, onRequestClose]);

  useImperativeHandle(forwardedRef, () => ({ flushSave, requestClose }), [flushSave, requestClose]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  useEffect(() => {
    clearAutoSaveTimer();
    if (!loadedRef.current || !dirty || mode !== 'edit') return;
    try {
      window.localStorage.setItem(localRecoveryKey(itemId), JSON.stringify({ savedAt: new Date().toISOString(), content }));
    } catch {
      // Local recovery is best-effort; server draft remains authoritative.
    }
    if (commandRef.current) return;
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (!commandRef.current) void saveDraft();
    }, AUTO_SAVE_DELAY);
    return clearAutoSaveTimer;
  }, [activeCommand, clearAutoSaveTimer, content, dirty, itemId, mode, saveDraft]);

  const updateNode = useCallback((index: number, updater: (node: SopNode) => SopNode) => {
    const next = cloneDocument(contentRef.current);
    const current = next.content[index];
    if (!current) return;
    next.content[index] = updater(current);
    applyDocument(next);
  }, [applyDocument]);

  const insertNode = useCallback((node: SopNode) => {
    const next = cloneDocument(contentRef.current);
    const target = selectedIndex === null ? next.content.length : Math.min(next.content.length, selectedIndex + 1);
    next.content.splice(target, 0, node);
    applyDocument(next);
    setSelectedIndex(target);
  }, [applyDocument, selectedIndex]);

  const deleteNode = useCallback((index: number) => {
    const next = cloneDocument(contentRef.current);
    next.content.splice(index, 1);
    if (!next.content.length) next.content.push(paragraph(''));
    applyDocument(next);
    setSelectedIndex(Math.min(index, next.content.length - 1));
  }, [applyDocument]);

  const moveNode = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction;
    const next = cloneDocument(contentRef.current);
    if (target < 0 || target >= next.content.length) return;
    const [node] = next.content.splice(index, 1);
    next.content.splice(target, 0, node);
    applyDocument(next);
    setSelectedIndex(target);
  }, [applyDocument]);

  const handleInsert = useCallback((kind: InsertKind) => {
    if (kind === 'image') {
      imageInputRef.current?.click();
      return;
    }
    insertNode(createInsertNode(kind));
  }, [insertNode]);

  const handleImage = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (commandRef.current) return;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMessage('仅支持 JPG、PNG 或 WEBP 图片');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMessage('单张图片不能超过 20 MB');
      return;
    }
    setUploading(true);
    setMessage('');
    try {
      const version = workspaceRef.current.draft || await saveDraft(true);
      if (!version?.id) throw new Error('请先保存草稿后再上传图片');
      const asset = await api.uploadAsset(file, version.id);
      if (!asset?.id) throw new Error('上传成功但未返回图片资源');
      setWorkspace(current => {
        const next = { ...current, assets: [asset, ...current.assets.filter(item => item.id !== asset.id)] };
        workspaceRef.current = next;
        return next;
      });
      insertNode({
        type: 'image',
        attrs: { assetId: asset.id, alt: file.name.replace(/\.[^.]+$/, ''), caption: '', widthPercent: 72, align: 'center' },
      });
    } catch (error) {
      setMessage(errorMessage(error, '上传 SOP 图片失败'));
    } finally {
      setUploading(false);
    }
  }, [api, insertNode, saveDraft]);

  const deleteImageAsset = useCallback(async (index: number, assetId?: string) => {
    if (!assetId) {
      deleteNode(index);
      return;
    }

    const previous = cloneDocument(contentRef.current);
    const next = cloneDocument(previous);
    next.content.splice(index, 1);
    if (!next.content.length) next.content.push(paragraph(''));
    applyDocument(next);
    setSelectedIndex(Math.min(index, next.content.length - 1));

    const saved = await saveDraft(true);
    if (!saved || dirtyRef.current) {
      // The server still has the old draft. Restore the local image node so the
      // screen never claims that a failed removal was saved.
      applyDocument(previous, false);
      setMessage('图片移除未保存成功，已恢复到编辑区，请稍后重试');
      return;
    }

    try {
      await api.deleteAsset(assetId);
      setWorkspace(current => {
        const next = { ...current, assets: current.assets.filter(asset => asset.id !== assetId) };
        workspaceRef.current = next;
        return next;
      });
      // A cleaned resource cannot be restored by editor undo; start a new undo
      // boundary after the irreversible cleanup.
      setUndoStack([]);
      setRedoStack([]);
      setMessage('图片已从当前草稿移除并清理');
    } catch (error) {
      if (errorStatus(error) === 409) {
        setMessage('图片已从当前草稿移除；已发布历史仍在引用，原资源已安全保留');
        return;
      }
      setMessage(`图片已从当前草稿移除；后台资源暂未清理：${errorMessage(error, '请稍后重试')}`);
    }
  }, [api, applyDocument, deleteNode, saveDraft]);

  const publish = useCallback(async () => {
    if (!beginCommand('publishing')) return;
    try {
      let version = await flushSave();
      if (!version) version = await saveDraft(true);
      if (!version?.id || dirtyRef.current) {
        setMessage('当前内容尚未保存成功，不能发布');
        return;
      }
      if (!exportSurfaceRef.current) {
        setMessage('SOP 导出页面尚未准备完成，请稍后重试');
        return;
      }

      const publishSnapshot = cloneDocument(contentRef.current);
      const publishSignature = documentSignature(publishSnapshot);
      setSaveState('saving');
      const pdf = await createSopPdfBlob(exportSurfaceRef.current);
      if (documentSignature(contentRef.current) !== publishSignature) {
        dirtyRef.current = true;
        setDirty(true);
        setSaveState('idle');
        setMessage('发布期间内容发生变化，修改已保留，请重新发布');
        return;
      }
      const title = workspaceRef.current.document?.title || workspaceRef.current.title || productLabel || 'SOP 作业指导书';
      const publishedWorkspace = normalizeWorkspace(await api.publish({
        versionId: version.id,
        expectedRevision: version.revision,
        title,
        pdf,
      }), itemId, productLabel);
      workspaceRef.current = publishedWorkspace;
      setWorkspace(publishedWorkspace);
      const unchanged = documentSignature(contentRef.current) === publishSignature;
      dirtyRef.current = !unchanged;
      setDirty(!unchanged);
      setSaveState(unchanged ? 'saved' : 'idle');
      if (unchanged) {
        setMode('published');
        window.localStorage.removeItem(localRecoveryKey(itemId));
      } else {
        setMode('edit');
        setMessage('发布快照已生成；发布期间新增修改已保留在当前草稿');
      }
      setConfirmAction(null);
      onPublished?.(publishedWorkspace);
    } catch (error) {
      setSaveState('error');
      setMessage(errorMessage(error, '发布 SOP 失败'));
    } finally {
      endCommand();
    }
  }, [api, beginCommand, endCommand, flushSave, itemId, onPublished, productLabel, saveDraft]);

  const restoreVersion = useCallback(async (version: SopVersion) => {
    if (!beginCommand('restoring')) return;
    try {
      await flushSave();
      if (dirtyRef.current) {
        setMessage('当前修改未能保存，已停止恢复历史版本');
        return;
      }
      const restored = normalizeVersion(await api.restore(version.id), productLabel);
      if (!restored) throw new Error('恢复成功但未返回草稿版本');
      setWorkspace(current => {
        const next = {
          ...current,
          draft: restored,
          versions: [restored, ...current.versions.filter(item => item.id !== restored.id)],
        };
        workspaceRef.current = next;
        return next;
      });
      setContent(restored.content);
      contentRef.current = restored.content;
      dirtyRef.current = false;
      setDirty(false);
      setSaveState('saved');
      setMode('edit');
      setHistoryVersion(null);
      setHistoryOpen(false);
      setMessage('已恢复为新草稿，原历史版本保持不变');
    } catch (error) {
      setMessage(errorMessage(error, '恢复 SOP 历史版本失败'));
    } finally {
      endCommand();
    }
  }, [api, beginCommand, endCommand, flushSave, productLabel]);

  const deleteDraft = useCallback(async () => {
    if (!beginCommand('deleting-draft')) return;
    try {
      await flushSave();
      if (dirtyRef.current) {
        setMessage('当前修改未能保存，已停止删除草稿');
        return;
      }
      const draft = workspaceRef.current.draft;
      const versionId = draft?.id;
      if (!versionId || draft.revision === undefined) {
        setContent(initialDocument);
        contentRef.current = initialDocument;
        dirtyRef.current = false;
        setDirty(false);
        setConfirmAction(null);
        return;
      }
      await api.deleteDraft(versionId, draft.revision);
      setWorkspace(current => {
        const next = { ...current, draft: null, versions: current.versions.filter(version => version.id !== versionId) };
        workspaceRef.current = next;
        return next;
      });
      const next = workspaceRef.current.publishedVersion?.content || initialDocument;
      setContent(next);
      contentRef.current = next;
      dirtyRef.current = false;
      setDirty(false);
      setSaveState('idle');
      setConfirmAction(null);
      setUndoStack([]);
      setRedoStack([]);
      window.localStorage.removeItem(localRecoveryKey(itemId));
    } catch (error) {
      setMessage(errorMessage(error, '删除 SOP 草稿失败'));
    } finally {
      endCommand();
    }
  }, [api, beginCommand, endCommand, flushSave, initialDocument, itemId]);

  const openPublishedPreview = useCallback(async () => {
    if (commandRef.current) return;
    await flushSave();
    if (dirtyRef.current) return;
    setHistoryVersion(null);
    setMode('published');
  }, [flushSave]);

  const openHistoryPreview = useCallback(async (version: SopVersion) => {
    if (commandRef.current) return;
    await flushSave();
    if (dirtyRef.current) return;
    setHistoryVersion(version);
    setMode('history');
    setHistoryOpen(false);
  }, [flushSave]);

  const previewVersion = historyVersion || workspace.publishedVersion;
  const previewReadOnly = mode !== 'edit';
  const interactionLocked = activeCommand !== null;
  const readOnly = previewReadOnly || interactionLocked;
  const displayDocument = previewReadOnly ? previewVersion?.content || content : content;
  const pages = useMemo(() => paginate(displayDocument.content), [displayDocument]);
  const assets = workspace.assets;

  const statusText = activeCommand === 'publishing'
    ? '正在生成并发布'
    : activeCommand === 'restoring'
      ? '正在恢复历史版本'
      : activeCommand === 'deleting-draft'
        ? '正在删除草稿'
        : saveState === 'saving'
          ? '正在保存'
    : saveState === 'conflict'
      ? '版本冲突'
      : saveState === 'error'
        ? '保存失败'
        : dirty
          ? '有未保存修改'
          : lastSavedAt
            ? `${safeDate(lastSavedAt.toISOString())} 已保存`
            : '等待编辑';

  const renderNode = (entry: IndexedNode) => {
    const { node, index } = entry;
    const selected = !readOnly && selectedIndex === index;
    return (
      <section
        className={`${styles.block}${selected ? ` ${styles.blockSelected}` : ''}${readOnly ? ` ${styles.blockReadOnly}` : ''}`}
        key={`${index}-${node.type}`}
        onClick={() => !readOnly && setSelectedIndex(index)}
      >
        {!readOnly && (
          <div className={styles.blockActions} aria-label="区块操作">
            <button type="button" title="上移" disabled={index <= 0} onClick={event => { event.stopPropagation(); moveNode(index, -1); }}><ArrowUp size={15} /></button>
            <button type="button" title="下移" disabled={index >= content.content.length - 1} onClick={event => { event.stopPropagation(); moveNode(index, 1); }}><ArrowDown size={15} /></button>
            <button type="button" title="删除区块" className={styles.dangerIcon} onClick={event => { event.stopPropagation(); deleteNode(index); }}><Trash2 size={15} /></button>
          </div>
        )}
        {renderNodeContent(node, index, readOnly, assets, updateNode, deleteImageAsset)}
      </section>
    );
  };

  if (loading) {
    return (
      <div className={`${styles.shell} ${className || ''}`}>
        <div className={styles.loading}><LoaderCircle className={styles.spin} size={28} /><strong>正在打开 SOP 编辑器</strong><span>加载草稿、资源与历史版本…</span></div>
      </div>
    );
  }

  return (
    <div className={`${styles.shell} ${className || ''}`}>
      <header className={styles.topbar}>
        <div className={styles.identity}>
          {(onClose || onRequestClose) && <button type="button" className={styles.iconButton} disabled={interactionLocked} onClick={() => void requestClose()} aria-label="返回"><ArrowLeft size={19} /></button>}
          <span className={styles.brandIcon}><BookOpenText size={21} /></span>
          <div><span>在线 SOP</span><strong>{workspace.title || productLabel || '作业指导书'}</strong></div>
        </div>
        <div className={`${styles.saveStatus} ${dirty ? styles.unsaved : ''} ${saveState === 'error' || saveState === 'conflict' ? styles.failed : ''}`}>
          {saveState === 'saving' || interactionLocked ? <LoaderCircle className={styles.spin} size={16} /> : saveState === 'error' || saveState === 'conflict' ? <CloudOff size={16} /> : <Cloud size={16} />}
          <span>{statusText}</span>
        </div>
        <div className={styles.topActions}>
          {mode !== 'edit' ? (
            <button type="button" className={styles.secondaryButton} disabled={interactionLocked} onClick={() => { setMode('edit'); setHistoryVersion(null); }}><ArrowLeft size={16} />返回编辑</button>
          ) : (
            <>
              <button type="button" className={styles.iconButton} disabled={interactionLocked || !undoStack.length} title="撤销" onClick={undo}><Undo2 size={18} /></button>
              <button type="button" className={styles.iconButton} disabled={interactionLocked || !redoStack.length} title="重做" onClick={redo}><Redo2 size={18} /></button>
              <button type="button" className={styles.secondaryButton} disabled={interactionLocked} onClick={() => void saveDraft(true)}><Save size={16} />保存</button>
            </>
          )}
          <button type="button" className={styles.secondaryButton} disabled={interactionLocked || !workspace.publishedVersion} onClick={() => void openPublishedPreview()}><Eye size={16} />已发布预览</button>
          <button type="button" className={styles.secondaryButton} disabled={interactionLocked} onClick={() => setHistoryOpen(true)}><History size={16} />历史版本</button>
          {mode === 'edit' && <button type="button" className={styles.primaryButton} disabled={interactionLocked || uploading} onClick={() => setConfirmAction('publish')}><Send size={16} />发布并生成 PDF</button>}
        </div>
      </header>

      {message && <div className={`${styles.notice} ${saveState === 'error' || saveState === 'conflict' ? styles.noticeError : ''}`}><AlertTriangle size={16} /><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="关闭消息"><X size={15} /></button></div>}
      {recovery && mode === 'edit' && (
        <div className={styles.recovery}>
          <RotateCcw size={17} />
          <div><strong>发现未同步的本地编辑</strong><span>可能来自页面意外关闭，可恢复后继续编辑。</span></div>
          <button type="button" disabled={interactionLocked} onClick={() => { applyDocument(recovery); setRecovery(null); }}>恢复内容</button>
          <button type="button" disabled={interactionLocked} className={styles.ghostButton} onClick={() => { setRecovery(null); window.localStorage.removeItem(localRecoveryKey(itemId)); }}>忽略</button>
        </div>
      )}

      <main className={`${styles.workspace}${previewReadOnly ? ` ${styles.workspacePreview}` : ''}`}>
        {!previewReadOnly && (
          <aside className={styles.insertRail}>
            <div className={styles.railHead}><span>插入内容</span><strong>结构化组件</strong></div>
            <div className={styles.toolGrid}>
              {insertTools.map(tool => (
                <button key={tool.kind} type="button" onClick={() => handleInsert(tool.kind)} disabled={interactionLocked || (uploading && tool.kind === 'image')}>
                  <span>{tool.icon}</span><strong>{tool.label}</strong><small>{tool.kind === 'image' && uploading ? '上传中…' : tool.hint}</small>
                </button>
              ))}
            </div>
            <div className={styles.railTip}><FileOutput size={17} /><p><strong>A4 输出提示</strong>使用“分页”控制换页；发布时由客户端生成 A4 PDF，并上传对象存储。</p></div>
          </aside>
        )}

        <section className={styles.canvasPanel}>
          <div className={styles.canvasToolbar}>
            <div><strong>{previewReadOnly && previewVersion ? `${versionStatus(previewVersion)}预览` : 'A4 编辑画布'}</strong><span>{pages.length} 页 · {displayDocument.content.filter(node => node.type !== 'pageBreak').length} 个内容区块</span></div>
            <div className={styles.zoomControl}>
              <button type="button" onClick={() => setZoom(value => Math.max(60, value - 5))}>−</button>
              <span>{zoom}%</span>
              <button type="button" onClick={() => setZoom(value => Math.min(110, value + 5))}>＋</button>
              <button type="button" onClick={() => setZoom(82)}>适合</button>
            </div>
          </div>
          <div className={styles.canvasScroll}>
            <div
              className={styles.pageStack}
              style={{
                '--sop-zoom': zoom / 100,
                '--sop-page-width': `${210 * zoom / 100}mm`,
                '--sop-page-height': `${297 * zoom / 100}mm`,
              } as CSSProperties}
            >
              {pages.map((page, pageIndex) => (
                <div className={styles.pageGroup} key={`page-${pageIndex}`}>
                  {pageIndex > 0 && page.breakBeforeIndex !== undefined && !readOnly && (
                    <div className={styles.pageBreakBar}><span>分页符 · 第 {pageIndex + 1} 页</span><button type="button" onClick={() => deleteNode(page.breakBeforeIndex as number)}>移除分页</button></div>
                  )}
                  <article className={styles.a4Page} aria-label={`SOP 第 ${pageIndex + 1} 页`}>
                    <div className={styles.pageContent}>
                      {page.entries.length ? page.entries.map(renderNode) : <button className={styles.emptyPage} type="button" disabled={readOnly} onClick={() => !readOnly && insertNode(paragraph('在这里填写内容。'))}><Plus size={20} />空白页面，点击添加正文</button>}
                    </div>
                    <footer className={styles.pageFooter}><span>{workspace.title || 'SOP 作业指导书'}</span><b>{pageIndex + 1} / {pages.length}</b></footer>
                  </article>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className={styles.inspector}>
          <div className={styles.inspectorHead}><span>文档状态</span><strong>{previewReadOnly ? '发布快照' : '当前草稿'}</strong></div>
          <dl className={styles.metrics}>
            <div><dt>页面</dt><dd>{pages.length}</dd></div>
            <div><dt>图片</dt><dd>{displayDocument.content.filter(node => node.type === 'image').length}</dd></div>
            <div><dt>版本</dt><dd>{previewVersion ? `V${previewVersion.version}` : workspace.draft ? `V${workspace.draft.version} · 草稿` : '草稿'}</dd></div>
            <div><dt>资源</dt><dd>{workspace.assets.length}</dd></div>
          </dl>
          {!previewReadOnly && selectedIndex !== null && content.content[selectedIndex] && (
            <div className={styles.selectionCard}>
              <span>当前选中</span><strong>{blockName(content.content[selectedIndex])}</strong>
              <p>可在画布内直接编辑；悬停区块可调整顺序或删除。</p>
              <button type="button" disabled={interactionLocked} onClick={() => insertNode(paragraph('在这里填写补充说明。'))}><Plus size={15} />在后面添加正文</button>
            </div>
          )}
          <div className={styles.lifecycle}>
            <span>发布流程</span>
            <ol><li className={styles.done}><Check size={13} />结构化编辑</li><li className={workspace.draft ? styles.done : ''}><Check size={13} />保存草稿</li><li className={workspace.publishedVersion ? styles.done : ''}><Check size={13} />生成 PDF</li><li className={workspace.publishedVersion ? styles.done : ''}><Check size={13} />发布归档</li></ol>
          </div>
          {!previewReadOnly && (
            <button type="button" className={styles.deleteDraftButton} disabled={interactionLocked} onClick={() => setConfirmAction('delete-draft')}><Trash2 size={16} />删除当前草稿</button>
          )}
        </aside>
      </main>

      <input ref={imageInputRef} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={interactionLocked} onChange={handleImage} />

      <div ref={exportSurfaceRef} className={styles.exportSurface} aria-hidden="true">
        {paginate(content.content).map((page, pageIndex, allPages) => (
          <article className={`${styles.a4Page} ${styles.exportPage}`} data-sop-export-page key={`export-${pageIndex}`}>
            <div className={styles.pageContent}>
              {page.entries.map(({ node, index }) => (
                <section className={`${styles.block} ${styles.blockReadOnly}`} key={`export-${index}-${node.type}`}>
                  {renderNodeContent(node, index, true, workspace.assets, () => undefined, async () => undefined)}
                </section>
              ))}
            </div>
            <footer className={styles.pageFooter}><span>{workspace.title || 'SOP 作业指导书'}</span><b>{pageIndex + 1} / {allPages.length}</b></footer>
          </article>
        ))}
      </div>

      {historyOpen && (
        <div className={styles.drawerBackdrop} role="presentation" onMouseDown={event => !interactionLocked && event.target === event.currentTarget && setHistoryOpen(false)}>
          <aside className={styles.historyDrawer} role="dialog" aria-modal="true" aria-label="SOP 历史版本">
            <header><div><span>版本记录</span><strong>历史版本与恢复</strong></div><button type="button" disabled={interactionLocked} onClick={() => setHistoryOpen(false)} aria-label="关闭历史版本"><X size={19} /></button></header>
            <div className={styles.historyList}>
              {workspace.versions.length ? workspace.versions.map(version => (
                <article key={version.id} className={historyVersion?.id === version.id ? styles.historyActive : ''}>
                  <div><span>{versionStatus(version)}</span><strong>V{version.version}</strong><small>{safeDate(version.publishedAt || version.updatedAt || version.createdAt)} · {version.updatedBy?.displayName || '系统用户'}</small></div>
                  <div className={styles.historyActions}>
                    <button type="button" disabled={interactionLocked} onClick={() => void openHistoryPreview(version)}><Eye size={15} />预览</button>
                    {version.status !== 'draft' && <button type="button" disabled={interactionLocked} onClick={() => void restoreVersion(version)}><RotateCcw size={15} />恢复为草稿</button>}
                  </div>
                </article>
              )) : <div className={styles.emptyHistory}><History size={25} /><strong>暂无历史版本</strong><span>首次发布后，版本记录会保留在这里。</span></div>}
            </div>
          </aside>
        </div>
      )}

      {confirmAction && (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={event => !interactionLocked && event.target === event.currentTarget && setConfirmAction(null)}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="sop-dialog-title">
            <span className={confirmAction === 'delete-draft' ? styles.dialogDangerIcon : styles.dialogPublishIcon}>{confirmAction === 'delete-draft' ? <Trash2 size={22} /> : <FileOutput size={22} />}</span>
            <div>
              <span>{confirmAction === 'delete-draft' ? '草稿管理' : '发布确认'}</span>
              <h2 id="sop-dialog-title">{confirmAction === 'delete-draft' ? '删除当前 SOP 草稿？' : '发布并生成正式 PDF'}</h2>
              <p>{confirmAction === 'delete-draft' ? '已发布版本和历史版本不会删除；未保存修改将无法恢复。' : '系统将保存当前草稿、生成 A4 PDF、上传对象存储，并建立不可变发布版本。'}</p>
            </div>
            <footer><button type="button" className={styles.secondaryButton} disabled={interactionLocked} onClick={() => setConfirmAction(null)}>取消</button><button type="button" disabled={interactionLocked} className={confirmAction === 'delete-draft' ? styles.dangerButton : styles.primaryButton} onClick={() => confirmAction === 'delete-draft' ? void deleteDraft() : void publish()}>{activeCommand ? <><LoaderCircle className={styles.spin} size={16} />处理中…</> : confirmAction === 'delete-draft' ? <><Trash2 size={16} />确认删除草稿</> : <><UploadCloud size={16} />生成并发布</>}</button></footer>
          </section>
        </div>
      )}
    </div>
  );
});

function blockName(node: SopNode): string {
  if (node.type === 'heading') return '章节标题';
  if (node.type === 'paragraph' && node.attrs?.variant === 'warning') return '注意事项';
  if (node.type === 'paragraph') return '正文段落';
  if (node.type === 'orderedList') return '作业步骤';
  if (node.type === 'bulletList') return '检查清单';
  if (node.type === 'table') return '参数表格';
  if (node.type === 'image') return '图片与图注';
  return '内容区块';
}

function renderNodeContent(
  node: SopNode,
  index: number,
  readOnly: boolean,
  assets: SopAsset[],
  updateNode: (index: number, updater: (node: SopNode) => SopNode) => void,
  deleteImageAsset: (index: number, assetId?: string) => Promise<void>,
): ReactNode {
  if (node.type === 'heading' || node.type === 'paragraph') {
    const warning = node.type === 'paragraph' && node.attrs?.variant === 'warning';
    const value = nodeText(node);
    if (readOnly) {
      if (node.type === 'heading') {
        const level = node.attrs?.level || 2;
        return level === 1 ? <h1 className={styles.readHeading1}>{value}</h1> : level === 3 ? <h3 className={styles.readHeading3}>{value}</h3> : <h2 className={styles.readHeading2}>{value}</h2>;
      }
      return warning ? <div className={styles.warningBlock}><AlertTriangle size={20} /><div><strong>{node.attrs?.title || '注意事项'}</strong><p>{value}</p></div></div> : <p className={styles.readParagraph}>{value}</p>;
    }
    return warning ? (
      <div className={styles.warningBlock}>
        <AlertTriangle size={20} />
        <div>
          <input className={styles.warningTitle} value={String(node.attrs?.title || '注意事项')} onChange={event => updateNode(index, current => ({ ...current, attrs: { ...current.attrs, title: event.target.value } }))} aria-label="警告标题" />
          <textarea value={value} onChange={event => updateNode(index, current => ({ ...current, content: inlineContentFromText(event.target.value) }))} aria-label="警告内容" />
        </div>
      </div>
    ) : (
      <textarea
        className={node.type === 'heading' ? node.attrs?.level === 1 ? styles.headingOneInput : styles.headingInput : styles.paragraphInput}
        value={value}
        rows={node.type === 'heading' ? 1 : Math.max(2, value.split('\n').length)}
        placeholder={node.type === 'heading' ? '输入章节标题' : '输入正文内容'}
        onChange={event => updateNode(index, current => ({ ...current, content: inlineContentFromText(event.target.value) }))}
      />
    );
  }

  if (node.type === 'orderedList' || node.type === 'bulletList') {
    const checklist = node.type === 'bulletList' && node.attrs?.variant === 'checklist';
    const items = node.content || [];
    if (readOnly) {
      const Tag = node.type === 'orderedList' ? 'ol' : 'ul';
      return <Tag className={`${styles.readList} ${checklist ? styles.readChecklist : ''}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{checklist && <span className={`${styles.checkBox} ${item.attrs?.checked ? styles.checked : ''}`}>{item.attrs?.checked ? <Check size={12} /> : null}</span>}<span>{listItemText(item)}</span></li>)}</Tag>;
    }
    const updateItem = (itemIndex: number, text: string) => updateNode(index, current => {
      const next = { ...current, content: [...(current.content || [])] };
      const item = next.content?.[itemIndex] || listItem('');
      if (next.content) next.content[itemIndex] = { ...item, content: [paragraph(text)] };
      return next;
    });
    return (
      <div className={styles.listEditor}>
        <div className={styles.blockCaption}><span>{checklist ? '作业检查清单' : '标准作业步骤'}</span><button type="button" onClick={() => updateNode(index, current => ({ ...current, content: [...(current.content || []), listItem(checklist ? '新增检查项目' : '新增作业步骤', checklist ? false : undefined)] }))}><Plus size={14} />新增一项</button></div>
        {items.map((item, itemIndex) => (
          <div className={styles.listRow} key={itemIndex}>
            {checklist ? <button type="button" className={`${styles.checkBox} ${item.attrs?.checked ? styles.checked : ''}`} onClick={() => updateNode(index, current => { const next = { ...current, content: [...(current.content || [])] }; const target = next.content?.[itemIndex]; if (target && next.content) next.content[itemIndex] = { ...target, attrs: { ...target.attrs, checked: !target.attrs?.checked } }; return next; })}>{item.attrs?.checked ? <Check size={12} /> : null}</button> : <span className={styles.stepNumber}>{String(itemIndex + 1).padStart(2, '0')}</span>}
            <textarea value={listItemText(item)} rows={1} onChange={event => updateItem(itemIndex, event.target.value)} aria-label={`${checklist ? '检查项' : '步骤'} ${itemIndex + 1}`} />
            <button type="button" className={styles.miniDanger} disabled={items.length <= 1} onClick={() => updateNode(index, current => ({ ...current, content: (current.content || []).filter((_, currentIndex) => currentIndex !== itemIndex) }))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    );
  }

  if (node.type === 'table') {
    const rows = node.content || [];
    if (readOnly) {
      return <div className={styles.tableWrap}><table className={styles.sopTable}><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{(row.content || []).map((cell, cellIndex) => cell.type === 'tableHeader' ? <th key={cellIndex}>{tableCellText(cell)}</th> : <td key={cellIndex}>{tableCellText(cell)}</td>)}</tr>)}</tbody></table></div>;
    }
    const columnCount = Math.max(1, rows[0]?.content?.length || 1);
    const updateCell = (rowIndex: number, cellIndex: number, value: string) => updateNode(index, current => {
      const next = cloneNode(current);
      const cell = next.content?.[rowIndex]?.content?.[cellIndex];
      if (cell) cell.content = [paragraph(value)];
      return next;
    });
    return (
      <div className={styles.tableEditor}>
        <div className={styles.blockCaption}><span>作业参数表</span><div><button type="button" onClick={() => updateNode(index, current => ({ ...current, content: [...(current.content || []), { type: 'tableRow', content: Array.from({ length: columnCount }, () => tableCell('')) }] }))}><Plus size={14} />行</button><button type="button" onClick={() => updateNode(index, current => ({ ...current, content: (current.content || []).map((row, rowIndex) => ({ ...row, content: [...(row.content || []), tableCell('', rowIndex === 0)] })) }))}><Plus size={14} />列</button></div></div>
        <div className={styles.tableWrap}><table className={styles.sopTable}><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{(row.content || []).map((cell, cellIndex) => { const Tag = cell.type === 'tableHeader' ? 'th' : 'td'; return <Tag key={cellIndex}><textarea rows={1} value={tableCellText(cell)} onChange={event => updateCell(rowIndex, cellIndex, event.target.value)} aria-label={`表格第 ${rowIndex + 1} 行第 ${cellIndex + 1} 列`} /></Tag>; })}</tr>)}</tbody></table></div>
        <div className={styles.tableFoot}><button type="button" disabled={rows.length <= 1} onClick={() => updateNode(index, current => ({ ...current, content: (current.content || []).slice(0, -1) }))}>删除末行</button><button type="button" disabled={columnCount <= 1} onClick={() => updateNode(index, current => ({ ...current, content: (current.content || []).map(row => ({ ...row, content: (row.content || []).slice(0, -1) })) }))}>删除末列</button></div>
      </div>
    );
  }

  if (node.type === 'image') {
    const asset = findAsset(assets, node.attrs?.assetId);
    const source = assetSource(asset);
    const width = Math.max(25, Math.min(100, Number(node.attrs?.widthPercent || 72)));
    const align = node.attrs?.align || 'center';
    return (
      <figure className={`${styles.imageBlock} ${styles[`align_${align}`]}`}>
        {source ? (
          // SOP 图片来自需要鉴权的对象存储临时地址，不能交给 next/image 代理优化。
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source} alt={String(node.attrs?.alt || asset?.originalName || 'SOP 图片')} style={{ width: `${width}%` }} />
        ) : <div className={styles.imageMissing}><ImagePlus size={28} /><strong>图片资源暂不可预览</strong><span>{asset?.originalName || node.attrs?.assetId || '缺少资源 ID'}</span></div>}
        {readOnly ? node.attrs?.caption && <figcaption>{String(node.attrs.caption)}</figcaption> : (
          <div className={styles.imageControls}>
            <input value={String(node.attrs?.caption || '')} onChange={event => updateNode(index, current => ({ ...current, attrs: { ...current.attrs, caption: event.target.value } }))} placeholder="填写图注（可选）" />
            <label><span>宽度 {width}%</span><input type="range" min="25" max="100" step="1" value={width} onChange={event => updateNode(index, current => ({ ...current, attrs: { ...current.attrs, widthPercent: Number(event.target.value) } }))} /></label>
            <select value={align} onChange={event => updateNode(index, current => ({ ...current, attrs: { ...current.attrs, align: event.target.value as 'left' | 'center' | 'right' } }))} aria-label="图片对齐"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select>
            <button type="button" className={styles.miniDanger} onClick={() => void deleteImageAsset(index, node.attrs?.assetId)}><Trash2 size={14} />移除并清理图片</button>
          </div>
        )}
      </figure>
    );
  }

  return null;
}

function cloneNode(node: SopNode): SopNode {
  return typeof structuredClone === 'function' ? structuredClone(node) : JSON.parse(JSON.stringify(node)) as SopNode;
}
