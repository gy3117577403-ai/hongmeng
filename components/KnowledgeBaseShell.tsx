'use client';

import {
  BookOpen,
  Boxes,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  FolderKanban,
  GitPullRequestArrow,
  Image as ImageIcon,
  Library,
  Link2,
  ListOrdered,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { WorkbenchPageHeader } from '@/components/layout/WorkbenchPageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImageViewer } from '@/components/ImageViewer';
import { PdfViewer } from '@/components/PdfViewer';
import { useModalLayer } from '@/components/useModalLayer';
import type {
  CurrentUserDTO,
  KnowledgeArticleCategory,
  KnowledgeArticleDTO,
  KnowledgeArticleStatus,
  KnowledgeAttachmentDTO,
  KnowledgeOverviewDTO,
  KnowledgePreviewDTO,
  KnowledgeRelationDTO,
  KnowledgeSearchItemDTO,
  KnowledgeSourceType,
} from '@/types';

type KnowledgeBaseShellProps = {
  user: CurrentUserDTO;
  initialState: {
    keyword: string;
    source: string;
    category: string;
    selectedKey: string;
  };
};
type SourceFilter = 'all' | KnowledgeSourceType;
type CategoryFilter = 'all' | KnowledgeArticleCategory;
type SearchResponse = { ok: boolean; results: KnowledgeSearchItemDTO[]; total: number; error?: string };
type OverviewResponse = { ok: boolean; overview: KnowledgeOverviewDTO; error?: string };
type ArticleResponse = { ok: boolean; article?: KnowledgeArticleDTO; error?: string };
type SearchFilters = {
  keyword?: string;
  source?: SourceFilter;
  category?: CategoryFilter;
  preferredKey?: string;
};
type ArticleForm = {
  title: string;
  category: KnowledgeArticleCategory;
  status: KnowledgeArticleStatus;
  summary: string;
  content: string;
  tags: string;
  customerName: string;
  specification: string;
  productModel: string;
  relations: KnowledgeRelationDTO[];
  version: number;
};

const emptyOverview: KnowledgeOverviewDTO = {
  totalSources: 0,
  articleCount: 0,
  drawingCount: 0,
  manualCount: 0,
  parameterCount: 0,
  processCount: 0,
  experienceCount: 0,
  changeCount: 0,
  draftCount: 0,
  updatedThisWeek: 0,
};

const emptyForm: ArticleForm = {
  title: '',
  category: 'general',
  status: 'published',
  summary: '',
  content: '',
  tags: '',
  customerName: '',
  specification: '',
  productModel: '',
  relations: [],
  version: 0,
};

const categoryLabels: Record<KnowledgeArticleCategory, string> = {
  problem: '问题处理经验',
  process: '工艺操作要点',
  inspection: '检验标准',
  equipment: '设备与工具',
  packaging: '包装注意事项',
  general: '通用技术说明',
};

const statusLabels: Record<KnowledgeArticleStatus, string> = { draft: '草稿', published: '有效', archived: '已归档' };

const sourceLabels: Record<KnowledgeSourceType, string> = {
  article: '经验知识',
  drawing: '图纸资料',
  manual: '组装说明书',
  parameter: '连接器参数',
  process: '工艺与工时',
  issue: '问题经验',
  change: '变更记录',
};

const sourceDefinitions: Array<{ key: SourceFilter; label: string; description: string; icon: LucideIcon; count: (overview: KnowledgeOverviewDTO) => number }> = [
  { key: 'all', label: '全部知识', description: '跨模块统一检索', icon: Library, count: overview => overview.totalSources },
  { key: 'article', label: '经验知识', description: '人工沉淀的技术经验', icon: FileText, count: overview => overview.articleCount },
  { key: 'drawing', label: '图纸资料', description: '客户、规格与生产资料', icon: FolderKanban, count: overview => overview.drawingCount },
  { key: 'manual', label: '组装说明书', description: '版本、目录与附件', icon: BookOpen, count: overview => overview.manualCount },
  { key: 'parameter', label: '连接器参数', description: '型号及剥皮入长参数', icon: Boxes, count: overview => overview.parameterCount },
  { key: 'process', label: '工艺与工时', description: '工序库与当前标准', icon: ListOrdered, count: overview => overview.processCount },
  { key: 'issue', label: '问题经验', description: '已关闭问题的处理结论', icon: CircleAlert, count: overview => overview.experienceCount },
  { key: 'change', label: '变更记录', description: '变更原因与验证结果', icon: GitPullRequestArrow, count: overview => overview.changeCount },
];

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => ({ ok: false, error: '服务返回格式异常' })) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function articleForm(article?: KnowledgeArticleDTO | null): ArticleForm {
  if (!article) return { ...emptyForm, relations: [] };
  return {
    title: article.title,
    category: article.category,
    status: article.status,
    summary: article.summary || '',
    content: article.content,
    tags: article.tags.join('，'),
    customerName: article.customerName || '',
    specification: article.specification || '',
    productModel: article.productModel || '',
    relations: [...article.relations],
    version: article.version,
  };
}

function relationFromItem(item: KnowledgeSearchItemDTO): KnowledgeRelationDTO | null {
  if (item.sourceType === 'article') return null;
  return {
    id: `pending:${item.key}`,
    articleId: '',
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourceLabel: item.title,
    sourceHref: item.sourceHref,
    createdAt: new Date().toISOString(),
  };
}

function articlePreview(article: KnowledgeArticleDTO): KnowledgePreviewDTO | null {
  const attachment = article.attachments.find(item => item.fileType === 'pdf' || ['jpg', 'png', 'webp'].includes(item.fileType));
  if (!attachment) return null;
  return { fileId: attachment.id, title: attachment.displayName || attachment.originalName, fileType: attachment.fileType === 'pdf' ? 'pdf' : 'image', contentUrl: attachment.contentUrl, downloadUrl: attachment.downloadUrl };
}

function previewCandidates(item: KnowledgeSearchItemDTO | null): KnowledgePreviewDTO[] {
  if (!item) return [];
  if (item.article) return item.article.attachments.filter(file => file.fileType === 'pdf' || ['jpg', 'png', 'webp'].includes(file.fileType)).map(file => ({ fileId: file.id, title: file.displayName || file.originalName, fileType: file.fileType === 'pdf' ? 'pdf' : 'image', contentUrl: file.contentUrl, downloadUrl: file.downloadUrl }));
  if (item.drawing) return item.drawing.files.filter(file => file.fileType === 'pdf' || file.fileType === 'image').map(file => ({ fileId: file.id, title: file.displayName || file.originalName, fileType: file.fileType === 'pdf' ? 'pdf' : 'image', contentUrl: file.contentUrl, downloadUrl: file.downloadUrl }));
  if (item.manual?.latestVersion) return item.manual.latestVersion.assets.map(file => ({ fileId: file.id, title: file.displayName || file.originalName, fileType: file.assetType === 'PDF' ? 'pdf' : 'image', contentUrl: file.contentUrl, downloadUrl: file.downloadUrl }));
  return item.preview ? [item.preview] : [];
}

export default function KnowledgeBaseShell({ user, initialState }: KnowledgeBaseShellProps) {
  const initialSource = initialState.source || 'all';
  const initialCategory = initialState.category || 'all';
  const [keyword, setKeyword] = useState(initialState.keyword);
  const [source, setSource] = useState<SourceFilter>(sourceDefinitions.some(item => item.key === initialSource) ? initialSource as SourceFilter : 'all');
  const [category, setCategory] = useState<CategoryFilter>(initialCategory === 'all' || Object.hasOwn(categoryLabels, initialCategory) ? initialCategory as CategoryFilter : 'all');
  const [overview, setOverview] = useState<KnowledgeOverviewDTO>(emptyOverview);
  const [results, setResults] = useState<KnowledgeSearchItemDTO[]>([]);
  const [selectedKey, setSelectedKey] = useState(initialState.selectedKey);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeArticleDTO | null>(null);
  const [form, setForm] = useState<ArticleForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteArticle, setDeleteArticle] = useState<KnowledgeArticleDTO | null>(null);
  const [deleteAttachment, setDeleteAttachment] = useState<KnowledgeAttachmentDTO | null>(null);
  const [previewOverride, setPreviewOverride] = useState<KnowledgePreviewDTO | null>(null);
  const [compactLayout, setCompactLayout] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const formTriggerRef = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => results.find(item => item.key === selectedKey) || null, [results, selectedKey]);
  const candidates = useMemo(() => previewCandidates(selected), [selected]);
  const activePreview = previewOverride || candidates[0] || null;

  const closeForm = useCallback((): void => {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setFormError('');
  }, [saving]);

  const closeInspector = useCallback((): void => setInspectorOpen(false), []);

  useModalLayer({ open: formOpen, layerRef: formRef, triggerRef: formTriggerRef, initialFocusRef: titleRef, backgroundRef: bodyRef, onClose: closeForm });
  useModalLayer({
    open: compactLayout && inspectorOpen,
    layerRef: detailRef,
    triggerRef: detailTriggerRef,
    onClose: closeInspector,
    interactionEnabled: !deleteArticle && !deleteAttachment,
  });

  const loadOverview = useCallback(async (): Promise<void> => {
    try {
      const data = await jsonRequest<OverviewResponse>('/api/knowledge/overview');
      setOverview(data.overview);
    } catch (loadError) {
      setToast(loadError instanceof Error ? loadError.message : '知识概览加载失败');
    }
  }, []);

  const loadSearch = useCallback(async (filters?: SearchFilters): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const nextSource = filters?.source ?? source;
      const nextCategory = filters?.category ?? category;
      const nextKeyword = filters?.keyword ?? keyword;
      const params = new URLSearchParams({ source: nextSource, category: nextCategory, limit: '60' });
      if (nextKeyword.trim()) params.set('keyword', nextKeyword.trim());
      const data = await jsonRequest<SearchResponse>(`/api/knowledge/search?${params.toString()}`);
      setResults(data.results);
      setSelectedKey(current => {
        if (filters?.preferredKey && data.results.some(item => item.key === filters.preferredKey)) return filters.preferredKey;
        return data.results.some(item => item.key === current) ? current : data.results[0]?.key || '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '知识检索失败');
      setResults([]);
      setSelectedKey('');
    } finally {
      setLoading(false);
    }
  }, [category, keyword, source]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSearch(); }, keyword.trim() ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [loadSearch, keyword]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const sync = (): void => setCompactLayout(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const detail = detailRef.current;
    if (!detail) return;
    if (compactLayout && !inspectorOpen) {
      detail.setAttribute('inert', '');
      detail.setAttribute('aria-hidden', 'true');
      return;
    }
    detail.removeAttribute('inert');
    detail.removeAttribute('aria-hidden');
  }, [compactLayout, inspectorOpen]);

  useEffect(() => {
    setPreviewOverride(null);
  }, [selectedKey]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('q', keyword.trim());
    if (source !== 'all') params.set('source', source);
    if (category !== 'all') params.set('category', category);
    if (selectedKey) params.set('item', selectedKey);
    const next = params.toString() ? `/workspace/knowledge?${params.toString()}` : '/workspace/knowledge';
    window.history.replaceState(null, '', next);
  }, [category, keyword, selectedKey, source]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  function selectItem(item: KnowledgeSearchItemDTO, trigger: HTMLElement): void {
    detailTriggerRef.current = trigger;
    setSelectedKey(item.key);
    if (compactLayout) setInspectorOpen(true);
  }

  function openCreate(trigger: HTMLElement, sourceItem?: KnowledgeSearchItemDTO | null): void {
    formTriggerRef.current = trigger;
    setEditing(null);
    const relation = sourceItem ? relationFromItem(sourceItem) : null;
    setForm({
      ...emptyForm,
      title: sourceItem ? `${sourceItem.title} 操作要点` : '',
      customerName: sourceItem?.customerName || '',
      specification: sourceItem?.specification || '',
      productModel: sourceItem?.productModel || '',
      relations: relation ? [relation] : [],
    });
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(trigger: HTMLElement, article: KnowledgeArticleDTO): void {
    formTriggerRef.current = trigger;
    setEditing(article);
    setForm(articleForm(article));
    setFormError('');
    setFormOpen(true);
  }

  function updateArticleResult(article: KnowledgeArticleDTO): void {
    setResults(current => current.map(item => item.sourceType === 'article' && item.sourceId === article.id ? {
      ...item,
      title: article.title,
      subtitle: `${article.code} · V${article.version}`,
      summary: article.summary || article.content.slice(0, 220),
      updatedAt: article.updatedAt,
      badges: [article.status, ...article.tags.slice(0, 2)],
      customerName: article.customerName,
      specification: article.specification,
      productModel: article.productModel,
      category: article.category,
      preview: articlePreview(article),
      article,
    } : item));
  }

  async function saveArticle(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.title.trim()) return setFormError('请输入知识标题');
    if (!form.content.trim()) return setFormError('请输入知识内容');
    setSaving(true);
    setFormError('');
    try {
      const wasEditing = !!editing;
      const payload = {
        title: form.title,
        category: form.category,
        status: form.status,
        summary: form.summary,
        content: form.content,
        tags: form.tags.split(/[，,]/).map(item => item.trim()).filter(Boolean),
        customerName: form.customerName,
        specification: form.specification,
        productModel: form.productModel,
        version: form.version,
        relations: form.relations.map(relation => ({ sourceType: relation.sourceType, sourceId: relation.sourceId, sourceLabel: relation.sourceLabel, sourceHref: relation.sourceHref })),
      };
      const data = await jsonRequest<ArticleResponse>(editing ? `/api/knowledge/articles/${editing.id}` : '/api/knowledge/articles', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!data.article) throw new Error('知识保存结果缺失');
      const article = data.article;
      setFormOpen(false);
      setEditing(null);
      setSource('article');
      setCategory('all');
      setKeyword(article.title);
      setSelectedKey(`article:${article.id}`);
      updateArticleResult(article);
      await Promise.all([
        loadOverview(),
        loadSearch({ keyword: article.title, source: 'article', category: 'all', preferredKey: `article:${article.id}` }),
      ]);
      setToast(wasEditing ? '知识文章已更新' : '知识文章已创建');
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : '知识保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeArticle(): Promise<void> {
    if (!deleteArticle) return;
    setSaving(true);
    try {
      await jsonRequest<{ ok: boolean }>(`/api/knowledge/articles/${deleteArticle.id}`, { method: 'DELETE' });
      setDeleteArticle(null);
      setInspectorOpen(false);
      setToast('知识文章已移入软删除状态');
      await Promise.all([loadOverview(), loadSearch()]);
    } catch (deleteError) {
      setToast(deleteError instanceof Error ? deleteError.message : '知识删除失败');
    } finally {
      setSaving(false);
    }
  }

  async function uploadAttachment(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    const article = selected?.article;
    event.target.value = '';
    if (!file || !article) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const data = await jsonRequest<ArticleResponse>(`/api/knowledge/articles/${article.id}/attachments/upload`, { method: 'POST', body });
      if (!data.article) throw new Error('附件上传结果缺失');
      updateArticleResult(data.article);
      setPreviewOverride(articlePreview(data.article));
      setToast('知识附件已上传');
      await loadOverview();
    } catch (uploadError) {
      setToast(uploadError instanceof Error ? uploadError.message : '知识附件上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(): Promise<void> {
    if (!deleteAttachment) return;
    setSaving(true);
    try {
      const data = await jsonRequest<ArticleResponse>(`/api/knowledge/attachments/${deleteAttachment.id}`, { method: 'DELETE' });
      if (!data.article) throw new Error('附件删除结果缺失');
      updateArticleResult(data.article);
      setPreviewOverride(null);
      setDeleteAttachment(null);
      setToast('知识附件已软删除');
    } catch (deleteError) {
      setToast(deleteError instanceof Error ? deleteError.message : '知识附件删除失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="hm-workbench-root hm-knowledge-workbench">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/knowledge"
        subtitle="跨模块检索、预览与技术经验沉淀"
        searchSlot={(
          <label className="hm-knowledge-header-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">搜索知识库</span>
            <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索客户、规格、型号、图纸、说明书或处理经验" />
            {keyword && <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setKeyword('')}><X size={15} /></button>}
            <kbd>Ctrl K</kbd>
          </label>
        )}
        menuItems={[{ label: '系统设置', href: '/dashboard?openSettings=1' }, { label: '退出登录', onSelect: logout }]}
      />

      <div ref={bodyRef} className="hm-knowledge-page">
        <WorkbenchPageHeader
          kicker="技术知识"
          title="知识库"
          titleId="knowledge-title"
          description="统一查找图纸、说明书、参数、工艺和已验证经验，资料仍由原业务模块维护。"
          actions={(
            <>
              <button className="hm-workbench-button" type="button" onClick={() => { void Promise.all([loadOverview(), loadSearch()]); }}><RefreshCw size={16} />刷新</button>
              <button className="hm-workbench-button primary" type="button" onClick={event => openCreate(event.currentTarget)}><Plus size={17} />新增知识</button>
            </>
          )}
        />

        <section className="hm-knowledge-metrics" aria-label="知识库概览">
          <article><Library /><div><span>可检索资料</span><strong>{overview.totalSources}</strong><small>来自全部已接入模块</small></div></article>
          <article><FileText /><div><span>经验知识</span><strong>{overview.articleCount}</strong><small>草稿 {overview.draftCount} 条</small></div></article>
          <article><FolderKanban /><div><span>图纸与说明书</span><strong>{overview.drawingCount + overview.manualCount}</strong><small>原始文件不重复存储</small></div></article>
          <article><Clock3 /><div><span>本周更新</span><strong>{overview.updatedThisWeek}</strong><small>人工知识条目</small></div></article>
        </section>

        <section className="hm-knowledge-layout" aria-label="知识检索工作台">
          <aside className="hm-knowledge-source-rail" aria-label="知识来源">
            <header><span>资料来源</span><small>{overview.totalSources} 项</small></header>
            <nav>
              {sourceDefinitions.map(definition => {
                const Icon = definition.icon;
                return (
                  <button className={source === definition.key ? 'active' : ''} type="button" key={definition.key} aria-pressed={source === definition.key} onClick={() => setSource(definition.key)}>
                    <Icon size={17} aria-hidden="true" />
                    <span><strong>{definition.label}</strong><small>{definition.description}</small></span>
                    <em>{definition.count(overview)}</em>
                  </button>
                );
              })}
            </nav>
            <div className="hm-knowledge-category-filter">
              <label htmlFor="knowledge-category">经验知识分类</label>
              <select id="knowledge-category" value={category} onChange={event => setCategory(event.target.value as CategoryFilter)}>
                <option value="all">全部分类</option>
                {Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </div>
          </aside>

          <section className="hm-knowledge-results" aria-labelledby="knowledge-results-title">
            <header>
              <div><span>检索结果</span><strong id="knowledge-results-title">{keyword ? `“${keyword}”` : '最近更新'}</strong></div>
              <em>{results.length} 项</em>
            </header>
            <div className="hm-knowledge-result-list hm-scroll-region" tabIndex={0}>
              {loading && <div className="hm-knowledge-loading"><Loader2 className="spin" /><strong>正在检索知识</strong></div>}
              {!loading && error && <div className="hm-knowledge-empty error"><CircleAlert /><strong>{error}</strong><button type="button" onClick={() => void loadSearch()}>重新加载</button></div>}
              {!loading && !error && !results.length && <div className="hm-knowledge-empty"><FileSearch /><strong>没有找到匹配内容</strong><p>可以换一个规格、型号或文件名，也可以新增一条经验知识。</p></div>}
              {!loading && results.map(item => {
                const definition = sourceDefinitions.find(entry => entry.key === item.sourceType);
                const Icon = definition?.icon || FileText;
                return (
                  <button className={selectedKey === item.key ? 'active' : ''} type="button" key={item.key} aria-pressed={selectedKey === item.key} onClick={event => selectItem(item, event.currentTarget)}>
                    <span className={`hm-knowledge-source-icon ${item.sourceType}`}><Icon size={17} /></span>
                    <span className="hm-knowledge-result-copy">
                      <span><em>{sourceLabels[item.sourceType]}</em><time>{formatDate(item.updatedAt)}</time></span>
                      <strong title={item.title}>{item.title}</strong>
                      {item.subtitle && <small title={item.subtitle}>{item.subtitle}</small>}
                      {item.summary && <p>{item.summary}</p>}
                      <span className="hm-knowledge-badges">{item.badges.slice(0, 3).map(badge => <i key={badge}>{badge}</i>)}</span>
                    </span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>

          {compactLayout && inspectorOpen && <button className="hm-knowledge-detail-scrim" type="button" aria-label="关闭知识详情" onClick={closeInspector} />}
          <aside ref={detailRef} className={`hm-knowledge-detail ${inspectorOpen ? 'open' : ''}`} aria-label="知识预览与详细信息" tabIndex={-1}>
            {!selected ? (
              <div className="hm-knowledge-detail-empty"><BookOpen /><strong>选择一项知识开始查看</strong><p>图纸、PDF、图片、参数和经验正文都会在这里展示。</p></div>
            ) : (
              <>
                <header className="hm-knowledge-detail-head">
                  <div><span>{sourceLabels[selected.sourceType]}</span><strong title={selected.title}>{selected.title}</strong><small>{selected.subtitle || '统一知识入口'}</small></div>
                  <nav>
                    {selected.sourceType !== 'article' && <button className="hm-touch-target" type="button" title="基于当前资料沉淀知识" aria-label="基于当前资料沉淀知识" onClick={event => openCreate(event.currentTarget, selected)}><Plus size={17} /></button>}
                    {selected.article && <button className="hm-touch-target" type="button" title="编辑知识" aria-label="编辑知识" onClick={event => openEdit(event.currentTarget, selected.article as KnowledgeArticleDTO)}><Pencil size={16} /></button>}
                    <a className="hm-touch-target" href={selected.sourceHref} title="打开来源模块" aria-label="打开来源模块"><ExternalLink size={16} /></a>
                    <button className="hm-knowledge-detail-close hm-touch-target" type="button" title="关闭详情" aria-label="关闭详情" onClick={closeInspector}><X size={17} /></button>
                  </nav>
                </header>
                <div className="hm-knowledge-detail-scroll hm-scroll-region" tabIndex={0}>
                  {activePreview ? (
                    <section className="hm-knowledge-preview-stage" aria-label="资料预览">
                      {activePreview.fileType === 'pdf'
                        ? <PdfViewer dashboardMode fileId={activePreview.fileId} title={activePreview.title} contentUrl={activePreview.contentUrl} downloadUrl={activePreview.downloadUrl} viewUrl={activePreview.contentUrl} />
                        : <ImageViewer dashboardMode fileId={activePreview.fileId} title={activePreview.title} contentUrl={activePreview.contentUrl} downloadUrl={activePreview.downloadUrl} />}
                    </section>
                  ) : (
                    <section className="hm-knowledge-no-preview"><FileSearch /><strong>当前内容没有可预览文件</strong><p>结构化参数和文字经验可直接在下方查看。</p></section>
                  )}

                  {candidates.length > 1 && <div className="hm-knowledge-file-strip" aria-label="关联文件">{candidates.map(file => <button className={activePreview?.fileId === file.fileId ? 'active' : ''} type="button" key={file.fileId} title={file.title} onClick={() => setPreviewOverride(file)}>{file.fileType === 'pdf' ? <FileText /> : <ImageIcon />}<span>{file.title}</span></button>)}</div>}

                  <section className="hm-knowledge-metadata">
                    {selected.customerName && <div><span>客户</span><strong>{selected.customerName}</strong></div>}
                    {selected.specification && <div><span>规格</span><strong>{selected.specification}</strong></div>}
                    {selected.productModel && <div><span>型号</span><strong>{selected.productModel}</strong></div>}
                    <div><span>更新时间</span><strong>{formatDate(selected.updatedAt)}</strong></div>
                  </section>

                  {selected.parameter && <section className="hm-knowledge-parameter-card"><h3>连接器参数</h3><div><span>外剥皮</span><strong>{selected.parameter.outerPeelMm || '未设置'}</strong></div><div><span>内剥皮</span><strong>{selected.parameter.innerPeelMm || '未设置'}</strong></div><div><span>入长</span><strong>{selected.parameter.insertionLengthMm || '未设置'}</strong></div>{selected.parameter.remark && <p>{selected.parameter.remark}</p>}</section>}

                  {selected.article && <ArticleDetail article={selected.article} onUpload={() => fileInputRef.current?.click()} uploading={uploading} onEdit={event => openEdit(event.currentTarget, selected.article as KnowledgeArticleDTO)} onDelete={setDeleteArticle} onDeleteAttachment={setDeleteAttachment} />}

                  {!selected.article && <section className="hm-knowledge-source-summary"><h3>内容摘要</h3><p>{selected.summary || '该资料暂无摘要，可进入来源模块查看完整内容。'}</p><a className="hm-workbench-button primary" href={selected.sourceHref}><ExternalLink size={16} />进入来源模块</a></section>}
                </div>
              </>
            )}
          </aside>
        </section>
      </div>

      <input ref={fileInputRef} className="hm-knowledge-hidden-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => void uploadAttachment(event)} />

      {formOpen && (
        <div className="hm-knowledge-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeForm(); }}>
          <section ref={formRef} className="hm-knowledge-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-form-title" tabIndex={-1}>
            <header><div><span>{editing ? '编辑知识' : '新增知识'}</span><strong id="knowledge-form-title">{editing ? editing.title : '沉淀一条可复用经验'}</strong></div><button type="button" aria-label="关闭" title="关闭" disabled={saving} onClick={closeForm}><X size={18} /></button></header>
            <form onSubmit={event => void saveArticle(event)}>
              <div className="hm-knowledge-form-grid hm-scroll-region">
                <label className="wide"><span>知识标题 *</span><input ref={titleRef} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} maxLength={160} /></label>
                <label><span>分类</span><select value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value as KnowledgeArticleCategory }))}>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label><span>状态</span><select value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as KnowledgeArticleStatus }))}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label><span>客户</span><input value={form.customerName} onChange={event => setForm(current => ({ ...current, customerName: event.target.value }))} placeholder="可选" /></label>
                <label><span>规格</span><input value={form.specification} onChange={event => setForm(current => ({ ...current, specification: event.target.value }))} placeholder="可选" /></label>
                <label><span>连接器型号</span><input value={form.productModel} onChange={event => setForm(current => ({ ...current, productModel: event.target.value }))} placeholder="可选" /></label>
                <label><span>标签</span><input value={form.tags} onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} placeholder="使用逗号分隔" /></label>
                <label className="wide"><span>摘要</span><textarea value={form.summary} onChange={event => setForm(current => ({ ...current, summary: event.target.value }))} rows={2} maxLength={500} placeholder="让现场人员快速判断这条知识是否适用" /></label>
                <label className="wide"><span>知识内容 *</span><textarea value={form.content} onChange={event => setForm(current => ({ ...current, content: event.target.value }))} rows={10} maxLength={30000} placeholder={'建议按以下结构填写：\n现象或目的\n原因\n处理步骤\n注意事项\n验证结果'} /></label>
                {!!form.relations.length && <section className="hm-knowledge-form-relations wide"><span>关联来源</span>{form.relations.map(relation => <div key={`${relation.sourceType}:${relation.sourceId}`}><Link2 size={15} /><strong>{sourceLabels[relation.sourceType]} · {relation.sourceLabel || relation.sourceId}</strong><button type="button" aria-label="移除关联" title="移除关联" onClick={() => setForm(current => ({ ...current, relations: current.relations.filter(item => item.id !== relation.id) }))}><X size={15} /></button></div>)}</section>}
              </div>
              {formError && <p className="hm-knowledge-form-error" role="alert">{formError}</p>}
              <footer><button className="hm-workbench-button" type="button" disabled={saving} onClick={closeForm}>取消</button><button className="hm-workbench-button primary" type="submit" disabled={saving} aria-busy={saving}>{saving ? <><Loader2 className="spin" />保存中</> : '保存知识'}</button></footer>
            </form>
          </section>
        </div>
      )}

      <ConfirmDialog open={!!deleteArticle} title="删除这条知识？" description="文章将软删除，关联的 S3 附件不会被物理清除。" confirmLabel="确认删除" danger busy={saving} onCancel={() => setDeleteArticle(null)} onConfirm={() => void removeArticle()} />
      <ConfirmDialog open={!!deleteAttachment} title="移除这个附件？" description={deleteAttachment ? `${deleteAttachment.displayName || deleteAttachment.originalName} 将从知识页面隐藏，S3 原文件保留。` : ''} confirmLabel="确认移除" danger busy={saving} onCancel={() => setDeleteAttachment(null)} onConfirm={() => void removeAttachment()} />
      {toast && <div className="hm-knowledge-toast" role="status">{toast}</div>}
    </main>
  );
}

function ArticleDetail({ article, onUpload, uploading, onEdit, onDelete, onDeleteAttachment }: {
  article: KnowledgeArticleDTO;
  onUpload: () => void;
  uploading: boolean;
  onEdit: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDelete: (article: KnowledgeArticleDTO) => void;
  onDeleteAttachment: (attachment: KnowledgeAttachmentDTO) => void;
}) {
  return (
    <>
      <article className="hm-knowledge-article-body">
        <header><div><span>{categoryLabels[article.category]}</span><strong>{article.code} · V{article.version}</strong></div><em className={article.status}>{statusLabels[article.status]}</em></header>
        {article.summary && <p className="summary">{article.summary}</p>}
        <div className="content">{article.content}</div>
        {!!article.tags.length && <div className="tags"><Tag size={15} />{article.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
      </article>
      <section className="hm-knowledge-article-relations">
        <h3>关联来源 <small>{article.relationCount}</small></h3>
        {article.relations.map(relation => relation.sourceHref ? <a href={relation.sourceHref} key={relation.id}><Link2 size={15} /><span>{sourceLabels[relation.sourceType]} · {relation.sourceLabel || relation.sourceId}</span><ExternalLink size={14} /></a> : <div key={relation.id}><Link2 size={15} /><span>{sourceLabels[relation.sourceType]} · {relation.sourceLabel || relation.sourceId}</span></div>)}
        {!article.relations.length && <p>暂未关联图纸、说明书或业务记录。</p>}
      </section>
      <section className="hm-knowledge-attachments">
        <header><h3>知识附件 <small>{article.attachmentCount}</small></h3><button className="hm-workbench-button" type="button" disabled={uploading} onClick={onUpload}>{uploading ? <Loader2 className="spin" /> : <Upload size={15} />}上传附件</button></header>
        {article.attachments.map(attachment => <div key={attachment.id}><Paperclip size={16} /><span><strong title={attachment.displayName || attachment.originalName}>{attachment.displayName || attachment.originalName}</strong><small>{formatBytes(attachment.size)} · {formatDate(attachment.createdAt)}</small></span><a href={attachment.downloadUrl} title="下载附件" aria-label={`下载 ${attachment.displayName || attachment.originalName}`}><Download size={16} /></a><button type="button" title="移除附件" aria-label={`移除 ${attachment.displayName || attachment.originalName}`} onClick={() => onDeleteAttachment(attachment)}><Trash2 size={15} /></button></div>)}
        {!article.attachments.length && <p>可上传 PDF、JPG、PNG 或 WEBP，文件保存到对象存储。</p>}
      </section>
      <footer className="hm-knowledge-article-actions"><button className="hm-workbench-button" type="button" onClick={onEdit}><Pencil size={15} />编辑知识</button><button className="hm-workbench-button danger" type="button" onClick={() => onDelete(article)}><Trash2 size={15} />删除</button></footer>
    </>
  );
}
