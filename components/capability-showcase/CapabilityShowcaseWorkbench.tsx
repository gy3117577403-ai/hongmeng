'use client';

import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  FileImage,
  Globe2,
  ImagePlus,
  Layers3,
  Link2,
  PackageOpen,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { useToast } from '@/components/ToastProvider';
import type {
  CapabilityShowcaseContent,
  ShowcaseCategory,
  ShowcaseItem,
  ShowcaseQualityItem,
  ShowcaseSpec,
} from '@/lib/capability-showcase';
import type {
  CapabilityShowcaseMediaDTO,
  CapabilityShowcaseShareDTO,
} from '@/lib/capability-showcase-service';
import type { CurrentUserDTO } from '@/types';
import { CapabilityShowcaseView } from './CapabilityShowcaseView';

type WorkbenchTab = 'site' | 'products' | 'processes' | 'quality' | 'publish';
type CatalogKind = 'products' | 'processes';
type PublicationDTO = { id: string; revision: number; createdAt: string; createdBy: string | null };
type WorkbenchPayload = {
  site: {
    id: string;
    draftRevision: number;
    publishedRevision: number | null;
    publishedAt: string | null;
    updatedAt: string;
    content: CapabilityShowcaseContent;
  };
  media: CapabilityShowcaseMediaDTO[];
  publications: PublicationDTO[];
  shares: CapabilityShowcaseShareDTO[];
};
type PendingConfirm =
  | { kind: 'category'; catalog: CatalogKind; id: string; title: string }
  | { kind: 'item'; catalog: CatalogKind; categoryId: string; id: string; title: string }
  | { kind: 'quality'; id: string; title: string }
  | { kind: 'media'; id: string; title: string }
  | { kind: 'share'; id: string; title: string };

const BUILT_IN_MEDIA = [
  ['车间首图', '/assets/capability-showcase/hero-factory.png'],
  ['常规裁线设备', '/assets/capability-showcase/equipment-cutting-standard.png'],
  ['高压裁线设备', '/assets/capability-showcase/equipment-cutting-high-voltage.png'],
  ['全自动压接设备', '/assets/capability-showcase/equipment-crimping-automatic.png'],
  ['半自动压接设备', '/assets/capability-showcase/equipment-crimping-semi-auto.png'],
  ['波纹管裁切设备', '/assets/capability-showcase/equipment-corrugated-tube.png'],
  ['沾锡设备', '/assets/capability-showcase/equipment-tinning.png'],
  ['热缩炉', '/assets/capability-showcase/equipment-heat-shrink.png'],
  ['电气测试设备', '/assets/capability-showcase/equipment-electrical-test.png'],
  ['高压线束示例', '/assets/capability-showcase/product-high-voltage-harness.png'],
  ['机器人线束示例', '/assets/capability-showcase/product-robot-harness.png'],
] as const;

function cloneContent(value: CapabilityShowcaseContent): CapabilityShowcaseContent {
  return structuredClone(value);
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function newSpec(): ShowcaseSpec {
  return { id: newId('spec'), label: '参数名称', value: '待录入' };
}

function newItem(kind: CatalogKind): ShowcaseItem {
  return {
    id: newId(kind === 'products' ? 'product' : 'equipment'),
    title: kind === 'products' ? '新产品条目' : '新设备或工位',
    kicker: kind === 'products' ? '产品类型' : '自动化类型',
    summary: '',
    image: '',
    imageAlt: '',
    tags: [],
    specs: [newSpec()],
    visible: true,
  };
}

function newCategory(kind: CatalogKind): ShowcaseCategory {
  return {
    id: newId(kind === 'products' ? 'product-category' : 'process-category'),
    name: kind === 'products' ? '新产品分类' : '新工艺分类',
    shortName: kind === 'products' ? '新产品' : '新工艺',
    summary: '',
    coverage: '',
    image: '',
    imageAlt: '',
    visible: true,
    items: [],
  };
}

function newQualityItem(): ShowcaseQualityItem {
  return {
    id: newId('quality'),
    title: '新质量项目',
    summary: '',
    evidenceLabel: '待补充真实依据',
    image: '',
    imageAlt: '',
    visible: true,
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return '尚未发生';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date).replace(/\//g, '-');
}

function WorkbenchImage({ src, alt }: { src: string; alt: string }) {
  return <Image src={src} alt={alt} width={900} height={620} unoptimized={src.startsWith('/api/')} sizes="(max-width: 900px) 45vw, 24vw" />;
}

async function responseData(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, any>>;
}

function TextField({ label, value, onChange, placeholder, maxLength = 160 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return <label className="showcase-field"><span>{label}<small>{value.length}/{maxLength}</small></span><input value={value} maxLength={maxLength} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>;
}

function TextAreaField({ label, value, onChange, placeholder, maxLength = 500 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return <label className="showcase-field showcase-field-wide"><span>{label}<small>{value.length}/{maxLength}</small></span><textarea value={value} maxLength={maxLength} placeholder={placeholder} rows={4} onChange={event => onChange(event.target.value)} /></label>;
}

function ImageField({ label, image, imageAlt, resolve, onChoose, onAltChange }: {
  label: string;
  image: string;
  imageAlt: string;
  resolve: (ref: string) => string;
  onChoose: () => void;
  onAltChange: (value: string) => void;
}) {
  return <div className="showcase-image-field">
    <span>{label}</span>
    <button type="button" onClick={onChoose}>{image ? <WorkbenchImage src={resolve(image)} alt={imageAlt || label} /> : <span><ImagePlus />选择图片</span>}<em>更换</em></button>
    <input value={imageAlt} maxLength={120} onChange={event => onAltChange(event.target.value)} placeholder="图片替代文字（便于无障碍与搜索）" />
  </div>;
}

function CatalogEditor({
  kind,
  categories,
  selectedCategoryId,
  selectedItemId,
  resolveImage,
  onSelectCategory,
  onSelectItem,
  onAddCategory,
  onAddItem,
  onMoveCategory,
  onMoveItem,
  onUpdateCategory,
  onUpdateItem,
  onDeleteCategory,
  onDeleteItem,
  onChooseImage,
}: {
  kind: CatalogKind;
  categories: ShowcaseCategory[];
  selectedCategoryId: string;
  selectedItemId: string;
  resolveImage: (ref: string) => string;
  onSelectCategory: (id: string) => void;
  onSelectItem: (id: string) => void;
  onAddCategory: () => void;
  onAddItem: () => void;
  onMoveCategory: (id: string, direction: -1 | 1) => void;
  onMoveItem: (categoryId: string, id: string, direction: -1 | 1) => void;
  onUpdateCategory: (id: string, patch: Partial<ShowcaseCategory>) => void;
  onUpdateItem: (categoryId: string, id: string, patch: Partial<ShowcaseItem>) => void;
  onDeleteCategory: (category: ShowcaseCategory) => void;
  onDeleteItem: (categoryId: string, item: ShowcaseItem) => void;
  onChooseImage: (label: string, onSelect: (ref: string) => void) => void;
}) {
  const category = categories.find(entry => entry.id === selectedCategoryId) || categories[0];
  const entry = category?.items.find(item => item.id === selectedItemId) || category?.items[0];
  return <section className="showcase-catalog-layout">
    <aside className="showcase-list-panel">
      <header><div><strong>{kind === 'products' ? '产品分类' : '工艺分类'}</strong><small>名称、顺序与显示状态均可修改</small></div><button type="button" onClick={onAddCategory} aria-label="新增分类"><Plus /></button></header>
      <div className="showcase-list-scroll">
        {categories.map((item, index) => <button type="button" className={category?.id === item.id ? 'active' : ''} key={item.id} onClick={() => onSelectCategory(item.id)}>
          {item.image ? <WorkbenchImage src={resolveImage(item.image)} alt="" /> : <span className="showcase-list-placeholder"><Layers3 /></span>}
          <span><strong>{item.shortName || item.name}</strong><small>{item.items.length} 个条目 · {item.visible ? '显示' : '隐藏'}</small></span>
          <em>{String(index + 1).padStart(2, '0')}</em>
        </button>)}
        {!categories.length && <div className="showcase-empty-small">还没有分类，点击右上角“+”建立。</div>}
      </div>
    </aside>

    <aside className="showcase-list-panel showcase-item-panel">
      <header><div><strong>{category?.name || '分类条目'}</strong><small>{kind === 'products' ? '产品图片与产品介绍' : '设备、工位与关键参数'}</small></div><button type="button" disabled={!category} onClick={onAddItem} aria-label="新增条目"><Plus /></button></header>
      <div className="showcase-category-actions">
        {category && <>
          <button type="button" onClick={() => onMoveCategory(category.id, -1)} title="分类上移"><ArrowUp /></button>
          <button type="button" onClick={() => onMoveCategory(category.id, 1)} title="分类下移"><ArrowDown /></button>
          <button type="button" className="danger" onClick={() => onDeleteCategory(category)} title="删除分类"><Trash2 /></button>
        </>}
      </div>
      <div className="showcase-list-scroll">
        {category?.items.map((item, index) => <button type="button" className={entry?.id === item.id ? 'active' : ''} key={item.id} onClick={() => onSelectItem(item.id)}>
          {item.image ? <WorkbenchImage src={resolveImage(item.image)} alt="" /> : <span className="showcase-list-placeholder"><PackageOpen /></span>}
          <span><strong>{item.title}</strong><small>{item.kicker || '类型未设置'} · {item.visible ? '显示' : '隐藏'}</small></span>
          <em>{String(index + 1).padStart(2, '0')}</em>
        </button>)}
        {category && !category.items.length && <div className="showcase-empty-small">此分类暂无条目，点击“+”添加。</div>}
      </div>
    </aside>

    <section className="showcase-form-panel">
      {!category ? <div className="showcase-empty-form"><Layers3 /><strong>先建立一个分类</strong><span>分类数量不固定，可按企业实际能力持续补充。</span></div> : !entry ? <div className="showcase-category-form">
        <header><div><span>{kind === 'products' ? 'PRODUCT CATEGORY' : 'PROCESS CATEGORY'}</span><h2>{category.name}</h2></div><label><input type="checkbox" checked={category.visible} onChange={event => onUpdateCategory(category.id, { visible: event.target.checked })} />对外显示</label></header>
        <div className="showcase-form-grid">
          <TextField label="分类名称" value={category.name} maxLength={80} onChange={value => onUpdateCategory(category.id, { name: value })} />
          <TextField label="短名称" value={category.shortName} maxLength={24} onChange={value => onUpdateCategory(category.id, { shortName: value })} />
          <TextField label={kind === 'products' ? '分类标签' : '覆盖范围'} value={category.coverage} maxLength={80} placeholder="例如：0.1–10 mm²" onChange={value => onUpdateCategory(category.id, { coverage: value })} />
          <TextAreaField label="分类说明" value={category.summary} onChange={value => onUpdateCategory(category.id, { summary: value })} />
          <ImageField label="分类封面" image={category.image} imageAlt={category.imageAlt} resolve={resolveImage} onChoose={() => onChooseImage('选择分类封面', ref => onUpdateCategory(category.id, { image: ref }))} onAltChange={value => onUpdateCategory(category.id, { imageAlt: value })} />
        </div>
      </div> : <div className="showcase-category-form">
        <header><div><span>{kind === 'products' ? 'PRODUCT ITEM' : 'EQUIPMENT ITEM'}</span><h2>{entry.title}</h2></div><label><input type="checkbox" checked={entry.visible} onChange={event => onUpdateItem(category.id, entry.id, { visible: event.target.checked })} />对外显示</label></header>
        <div className="showcase-item-actions">
          <button type="button" onClick={() => onMoveItem(category.id, entry.id, -1)}><ArrowUp />上移</button>
          <button type="button" onClick={() => onMoveItem(category.id, entry.id, 1)}><ArrowDown />下移</button>
          <button type="button" className="danger" onClick={() => onDeleteItem(category.id, entry)}><Trash2 />删除</button>
          <button type="button" onClick={() => onSelectItem('')}>编辑分类信息</button>
        </div>
        <div className="showcase-form-grid">
          <TextField label={kind === 'products' ? '产品名称' : '设备/工位名称'} value={entry.title} maxLength={80} onChange={value => onUpdateItem(category.id, entry.id, { title: value })} />
          <TextField label={kind === 'products' ? '产品类型' : '自动化类型'} value={entry.kicker} maxLength={40} placeholder={kind === 'products' ? '例如：高压线束' : '例如：全自动 / 半自动'} onChange={value => onUpdateItem(category.id, entry.id, { kicker: value })} />
          <TextAreaField label="介绍说明" value={entry.summary} onChange={value => onUpdateItem(category.id, entry.id, { summary: value })} />
          <label className="showcase-field showcase-field-wide"><span>标签<small>使用中文逗号分隔</small></span><input value={entry.tags.join('，')} onChange={event => onUpdateItem(category.id, entry.id, { tags: event.target.value.split(/[，,]/).map(value => value.trim()).filter(Boolean).slice(0, 12) })} placeholder="例如：定长裁切，自动送料" /></label>
          <ImageField label="展示图片" image={entry.image} imageAlt={entry.imageAlt} resolve={resolveImage} onChoose={() => onChooseImage('选择条目图片', ref => onUpdateItem(category.id, entry.id, { image: ref }))} onAltChange={value => onUpdateItem(category.id, entry.id, { imageAlt: value })} />
          <div className="showcase-spec-editor showcase-field-wide">
            <header><strong>规格与说明</strong><button type="button" onClick={() => onUpdateItem(category.id, entry.id, { specs: [...entry.specs, newSpec()] })}><Plus />添加参数</button></header>
            {entry.specs.map(specification => <div key={specification.id}>
              <input value={specification.label} maxLength={40} onChange={event => onUpdateItem(category.id, entry.id, { specs: entry.specs.map(row => row.id === specification.id ? { ...row, label: event.target.value } : row) })} placeholder="参数名称" />
              <input value={specification.value} maxLength={120} onChange={event => onUpdateItem(category.id, entry.id, { specs: entry.specs.map(row => row.id === specification.id ? { ...row, value: event.target.value } : row) })} placeholder="参数内容" />
              <button type="button" aria-label={`删除参数“${specification.label}”`} onClick={() => onUpdateItem(category.id, entry.id, { specs: entry.specs.filter(row => row.id !== specification.id) })}><X /></button>
            </div>)}
          </div>
        </div>
      </div>}
    </section>
  </section>;
}

export function CapabilityShowcaseWorkbench({ user }: { user: CurrentUserDTO }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<WorkbenchTab>('site');
  const [content, setContent] = useState<CapabilityShowcaseContent | null>(null);
  const [savedContent, setSavedContent] = useState('');
  const [draftRevision, setDraftRevision] = useState(1);
  const [publishedRevision, setPublishedRevision] = useState<number | null>(null);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [media, setMedia] = useState<CapabilityShowcaseMediaDTO[]>([]);
  const [publications, setPublications] = useState<PublicationDTO[]>([]);
  const [shares, setShares] = useState<CapabilityShowcaseShareDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaSelectionMode, setMediaSelectionMode] = useState(false);
  const [mediaTitle, setMediaTitle] = useState('选择图片');
  const mediaSelectRef = useRef<((ref: string) => void) | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [productCategoryId, setProductCategoryId] = useState('');
  const [productItemId, setProductItemId] = useState('');
  const [processCategoryId, setProcessCategoryId] = useState('');
  const [processItemId, setProcessItemId] = useState('');
  const [qualityId, setQualityId] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [shareLabel, setShareLabel] = useState('客户能力资料');
  const [shareDays, setShareDays] = useState('30');
  const [createdShareUrl, setCreatedShareUrl] = useState('');

  const dirty = !!content && JSON.stringify(content) !== savedContent;
  const visibleProductCount = content?.products.categories.filter(entry => entry.visible).length || 0;
  const visibleProcessCount = content?.processes.categories.filter(entry => entry.visible).length || 0;
  const visibleEquipmentCount = content?.processes.categories.reduce((sum, category) => sum + category.items.filter(entry => entry.visible).length, 0) || 0;

  const loadWorkbench = useCallback(async () => {
    if (dirty && !loading) {
      showToast('当前有未保存修改，请先保存后再刷新', { tone: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/capability-showcase', { cache: 'no-store' });
      const payload = await responseData(response);
      if (!response.ok) throw new Error(String(payload.error || '能力展厅加载失败'));
      const workbench = payload as unknown as WorkbenchPayload;
      setContent(workbench.site.content);
      setSavedContent(JSON.stringify(workbench.site.content));
      setDraftRevision(workbench.site.draftRevision);
      setPublishedRevision(workbench.site.publishedRevision);
      setPublishedAt(workbench.site.publishedAt);
      setUpdatedAt(workbench.site.updatedAt);
      setMedia(workbench.media);
      setPublications(workbench.publications);
      setShares(workbench.shares);
      setProductCategoryId(workbench.site.content.products.categories[0]?.id || '');
      setProductItemId(workbench.site.content.products.categories[0]?.items[0]?.id || '');
      setProcessCategoryId(workbench.site.content.processes.categories[0]?.id || '');
      setProcessItemId(workbench.site.content.processes.categories[0]?.items[0]?.id || '');
      setQualityId(workbench.site.content.quality.items[0]?.id || '');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '能力展厅加载失败', { tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [dirty, loading, showToast]);

  useEffect(() => {
    void loadWorkbench();
    // Initial load only. Refresh is explicit so unsaved edits cannot be replaced silently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const edit = useCallback((mutate: (draft: CapabilityShowcaseContent) => void) => {
    setContent(current => {
      if (!current) return current;
      const draft = cloneContent(current);
      mutate(draft);
      return draft;
    });
  }, []);

  const resolveImage = useCallback((ref: string) => {
    if (!ref.startsWith('media:')) return ref;
    return `/api/capability-showcase/media/${encodeURIComponent(ref.slice('media:'.length))}/content`;
  }, []);

  function chooseImage(title: string, onSelect: (ref: string) => void) {
    mediaSelectRef.current = onSelect;
    setMediaSelectionMode(true);
    setMediaTitle(title);
    setMediaOpen(true);
  }

  function openMediaLibrary() {
    mediaSelectRef.current = null;
    setMediaSelectionMode(false);
    setMediaTitle('素材库');
    setMediaOpen(true);
  }

  function closeMediaLibrary() {
    mediaSelectRef.current = null;
    setMediaSelectionMode(false);
    setMediaOpen(false);
  }

  function commitImage(ref: string) {
    const select = mediaSelectRef.current;
    if (!select) return;
    select(ref);
    closeMediaLibrary();
  }

  async function saveDraft() {
    if (!content || !dirty) return;
    setSaving(true);
    try {
      const response = await fetch('/api/capability-showcase', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: draftRevision, content }),
      });
      const payload = await responseData(response);
      if (!response.ok) throw new Error(String(payload.error || '保存失败'));
      const nextContent = payload.content as CapabilityShowcaseContent;
      setContent(nextContent);
      setSavedContent(JSON.stringify(nextContent));
      setDraftRevision(Number(payload.draftRevision));
      setUpdatedAt(String(payload.updatedAt));
      showToast('能力展厅草稿已保存', { tone: 'success' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '能力展厅保存失败', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (dirty) {
      showToast('发布前请先保存当前修改', { tone: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/capability-showcase/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: draftRevision }),
      });
      const payload = await responseData(response);
      if (!response.ok) throw new Error(String(payload.error || '发布失败'));
      const publication = payload.publication as PublicationDTO;
      setPublishedRevision(publication.revision);
      setPublishedAt(publication.createdAt);
      setPublications(current => [publication, ...current.filter(entry => entry.id !== publication.id)].slice(0, 12));
      showToast(`能力展厅 V${publication.revision} 已发布`, { tone: 'success' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '发布失败', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function createShare() {
    setSaving(true);
    try {
      const response = await fetch('/api/capability-showcase/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: shareLabel, expiresInDays: shareDays.trim() || null }),
      });
      const payload = await responseData(response);
      if (!response.ok) throw new Error(String(payload.error || '分享链接创建失败'));
      const share = payload.share as CapabilityShowcaseShareDTO;
      const url = `${window.location.origin}/showcase/${payload.token}`;
      setShares(current => [share, ...current]);
      setCreatedShareUrl(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      showToast('只读分享链接已创建并复制；完整链接只显示本次', { tone: 'success', duration: 5000 });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '分享链接创建失败', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function uploadMedia(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('displayName', file.name.replace(/\.[^.]+$/, ''));
      const response = await fetch('/api/capability-showcase/media/upload', { method: 'POST', body: form });
      const payload = await responseData(response);
      if (!response.ok) throw new Error(String(payload.error || '图片上传失败'));
      const uploaded = payload.media as CapabilityShowcaseMediaDTO;
      setMedia(current => [uploaded, ...current]);
      showToast('图片已上传到对象存储', { tone: 'success' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '图片上传失败', { tone: 'error' });
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  function updateCategory(catalog: CatalogKind, id: string, patch: Partial<ShowcaseCategory>) {
    edit(draft => {
      draft[catalog].categories = draft[catalog].categories.map(entry => entry.id === id ? { ...entry, ...patch } : entry);
    });
  }

  function updateItem(catalog: CatalogKind, categoryId: string, id: string, patch: Partial<ShowcaseItem>) {
    edit(draft => {
      draft[catalog].categories = draft[catalog].categories.map(category => category.id === categoryId
        ? { ...category, items: category.items.map(entry => entry.id === id ? { ...entry, ...patch } : entry) }
        : category);
    });
  }

  function addCategory(catalog: CatalogKind) {
    const created = newCategory(catalog);
    edit(draft => { draft[catalog].categories.push(created); });
    if (catalog === 'products') { setProductCategoryId(created.id); setProductItemId(''); }
    else { setProcessCategoryId(created.id); setProcessItemId(''); }
  }

  function addItem(catalog: CatalogKind, categoryId: string) {
    if (!categoryId) return;
    const created = newItem(catalog);
    edit(draft => {
      const category = draft[catalog].categories.find(entry => entry.id === categoryId);
      category?.items.push(created);
    });
    if (catalog === 'products') setProductItemId(created.id);
    else setProcessItemId(created.id);
  }

  function moveCategory(catalog: CatalogKind, id: string, direction: -1 | 1) {
    edit(draft => {
      const list = draft[catalog].categories;
      const index = list.findIndex(entry => entry.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
    });
  }

  function moveItem(catalog: CatalogKind, categoryId: string, id: string, direction: -1 | 1) {
    edit(draft => {
      const list = draft[catalog].categories.find(entry => entry.id === categoryId)?.items;
      if (!list) return;
      const index = list.findIndex(entry => entry.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
    });
  }

  async function confirmPending() {
    if (!pendingConfirm || !content) return;
    setConfirmBusy(true);
    try {
      if (pendingConfirm.kind === 'category') {
        const next = content[pendingConfirm.catalog].categories.filter(entry => entry.id !== pendingConfirm.id);
        edit(draft => { draft[pendingConfirm.catalog].categories = next; });
        if (pendingConfirm.catalog === 'products') {
          setProductCategoryId(next[0]?.id || ''); setProductItemId(next[0]?.items[0]?.id || '');
        } else {
          setProcessCategoryId(next[0]?.id || ''); setProcessItemId(next[0]?.items[0]?.id || '');
        }
      } else if (pendingConfirm.kind === 'item') {
        const category = content[pendingConfirm.catalog].categories.find(entry => entry.id === pendingConfirm.categoryId);
        const nextItems = category?.items.filter(entry => entry.id !== pendingConfirm.id) || [];
        edit(draft => {
          const target = draft[pendingConfirm.catalog].categories.find(entry => entry.id === pendingConfirm.categoryId);
          if (target) target.items = nextItems;
        });
        if (pendingConfirm.catalog === 'products') setProductItemId(nextItems[0]?.id || '');
        else setProcessItemId(nextItems[0]?.id || '');
      } else if (pendingConfirm.kind === 'quality') {
        const next = content.quality.items.filter(entry => entry.id !== pendingConfirm.id);
        edit(draft => { draft.quality.items = next; });
        setQualityId(next[0]?.id || '');
      } else if (pendingConfirm.kind === 'media') {
        const response = await fetch(`/api/capability-showcase/media/${encodeURIComponent(pendingConfirm.id)}`, { method: 'DELETE' });
        const payload = await responseData(response);
        if (!response.ok) throw new Error(String(payload.error || '图片删除失败'));
        setMedia(current => current.filter(entry => entry.id !== pendingConfirm.id));
        showToast('图片已软删除，对象存储文件保留', { tone: 'success' });
      } else if (pendingConfirm.kind === 'share') {
        const response = await fetch(`/api/capability-showcase/shares/${encodeURIComponent(pendingConfirm.id)}`, { method: 'DELETE' });
        const payload = await responseData(response);
        if (!response.ok) throw new Error(String(payload.error || '分享链接停用失败'));
        setShares(current => current.map(entry => entry.id === pendingConfirm.id ? { ...entry, revokedAt: new Date().toISOString() } : entry));
        showToast('只读分享链接已停用', { tone: 'success' });
      }
      setPendingConfirm(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败', { tone: 'error' });
    } finally {
      setConfirmBusy(false);
    }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    showToast('链接已复制', { tone: 'success' });
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  const qualityItem = content?.quality.items.find(entry => entry.id === qualityId) || content?.quality.items[0];

  return <main className="showcase-workbench hm-workbench-root">
    <AppWorkbenchHeader
      user={user}
      activeHref="/workspace/capability-showcase"
      subtitle="产品、工艺、设备与只读分享网页"
      menuItems={[{ label: '刷新资料', onSelect: loadWorkbench }, { label: '返回首页', href: '/home' }, { label: '退出登录', onSelect: logout }]}
    />

    <section className="showcase-command-bar">
      <div className="showcase-tabs" role="tablist" aria-label="能力展厅内容维护">
        <button type="button" className={tab === 'site' ? 'active' : ''} onClick={() => setTab('site')}><Settings2 />站点与首屏</button>
        <button type="button" className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}><PackageOpen />产品介绍 <small>{visibleProductCount}</small></button>
        <button type="button" className={tab === 'processes' ? 'active' : ''} onClick={() => setTab('processes')}><Layers3 />工艺与设备 <small>{visibleProcessCount}</small></button>
        <button type="button" className={tab === 'quality' ? 'active' : ''} onClick={() => setTab('quality')}><ShieldCheck />质量管控</button>
        <button type="button" className={tab === 'publish' ? 'active' : ''} onClick={() => setTab('publish')}><Globe2 />发布与分享</button>
      </div>
      <div className="showcase-command-actions">
        <span className={dirty ? 'dirty' : ''}>{loading ? '正在读取…' : dirty ? '有未保存修改' : `草稿 V${draftRevision}`}</span>
        <button type="button" onClick={openMediaLibrary}><FileImage />素材库</button>
        <button type="button" onClick={() => setPreviewOpen(true)} disabled={!content}><Eye />预览草稿</button>
        <button type="button" className="primary" onClick={saveDraft} disabled={!dirty || saving}><Save />{saving ? '处理中…' : '保存草稿'}</button>
      </div>
    </section>

    <section className="showcase-stat-row">
      <article><span>产品分类</span><strong>{visibleProductCount}</strong><small>对外显示</small></article>
      <article><span>工艺分类</span><strong>{visibleProcessCount}</strong><small>可继续扩展</small></article>
      <article><span>设备与工位</span><strong>{visibleEquipmentCount}</strong><small>从工艺汇总</small></article>
      <article className={publishedRevision ? 'published' : ''}><span>发布状态</span><strong>{publishedRevision ? `V${publishedRevision}` : '未发布'}</strong><small>{formatDateTime(publishedAt)}</small></article>
    </section>

    <section className="showcase-work-area">
      {loading && !content ? <div className="showcase-loading"><RefreshCw /><strong>正在加载能力展厅</strong></div> : !content ? <div className="showcase-loading"><Globe2 /><strong>暂时无法读取内容</strong><button type="button" onClick={loadWorkbench}>重新加载</button></div> : <>
        {tab === 'site' && <section className="showcase-site-layout">
          <aside>
            <div className="showcase-guidance-card"><span>发布前检查</span><h2>先使用示例版排版，再逐项替换真实资料</h2><p>示例图片由生成式图像工具制作，不代表现有设备实拍。关闭“演示模式”前，应核实图片、线径、设备名称、检验能力与联系方式。</p><label><input type="checkbox" checked={content.sampleMode} onChange={event => edit(draft => { draft.sampleMode = event.target.checked; })} />保持演示资料提示</label></div>
            <div className="showcase-update-card"><span>草稿更新时间</span><strong>{formatDateTime(updatedAt)}</strong><small>所有登录用户维护同一份内容；版本冲突时系统会阻止覆盖。</small></div>
          </aside>
          <section className="showcase-settings-panel">
            <header><div><span>SITE SETTINGS</span><h1>站点与首屏</h1><p>名称、菜单、主视觉和合作联系方式</p></div><button type="button" onClick={() => chooseImage('选择首屏图片', ref => edit(draft => { draft.hero.image = ref; }))}><ImagePlus />更换主视觉</button></header>
            <div className="showcase-form-grid showcase-site-fields">
              <TextField label="站点名称" value={content.identity.brandName} maxLength={60} onChange={value => edit(draft => { draft.identity.brandName = value; })} />
              <TextField label="站点副标题" value={content.identity.brandTagline} maxLength={140} onChange={value => edit(draft => { draft.identity.brandTagline = value; })} />
              <TextField label="首屏眉题" value={content.hero.eyebrow} maxLength={50} onChange={value => edit(draft => { draft.hero.eyebrow = value; })} />
              <TextField label="重点范围" value={content.hero.highlight} maxLength={40} onChange={value => edit(draft => { draft.hero.highlight = value; })} />
              <TextField label="首屏主标题" value={content.hero.title} maxLength={100} onChange={value => edit(draft => { draft.hero.title = value; })} />
              <TextAreaField label="首屏说明" value={content.hero.subtitle} maxLength={400} onChange={value => edit(draft => { draft.hero.subtitle = value; })} />
              <ImageField label="首屏主视觉" image={content.hero.image} imageAlt={content.hero.imageAlt} resolve={resolveImage} onChoose={() => chooseImage('选择首屏图片', ref => edit(draft => { draft.hero.image = ref; }))} onAltChange={value => edit(draft => { draft.hero.imageAlt = value; })} />
              <div className="showcase-subsection showcase-field-wide"><h3>顶部菜单名称</h3><div className="showcase-inline-grid">
                {(Object.keys(content.navigation) as Array<keyof typeof content.navigation>).map(key => <TextField key={key} label={{ overview: '能力全景', products: '产品介绍', processes: '工艺流程', equipment: '设备与技术', quality: '质量管控', support: '合作支持' }[key]} value={content.navigation[key]} maxLength={16} onChange={value => edit(draft => { draft.navigation[key] = value; })} />)}
              </div></div>
              <div className="showcase-subsection showcase-field-wide"><h3>合作支持</h3><div className="showcase-inline-grid">
                <TextField label="区块标题" value={content.support.title} maxLength={100} onChange={value => edit(draft => { draft.support.title = value; })} />
                <TextField label="联系人" value={content.support.contactName} maxLength={60} onChange={value => edit(draft => { draft.support.contactName = value; })} />
                <TextField label="联系电话" value={content.support.contactPhone} maxLength={40} onChange={value => edit(draft => { draft.support.contactPhone = value; })} />
                <TextField label="联系邮箱" value={content.support.contactEmail} maxLength={120} onChange={value => edit(draft => { draft.support.contactEmail = value; })} />
                <TextAreaField label="合作说明" value={content.support.description} maxLength={400} onChange={value => edit(draft => { draft.support.description = value; })} />
              </div></div>
            </div>
          </section>
        </section>}

        {tab === 'products' && <CatalogEditor kind="products" categories={content.products.categories} selectedCategoryId={productCategoryId} selectedItemId={productItemId} resolveImage={resolveImage} onSelectCategory={id => { setProductCategoryId(id); setProductItemId(content.products.categories.find(entry => entry.id === id)?.items[0]?.id || ''); }} onSelectItem={setProductItemId} onAddCategory={() => addCategory('products')} onAddItem={() => addItem('products', productCategoryId)} onMoveCategory={(id, direction) => moveCategory('products', id, direction)} onMoveItem={(categoryId, id, direction) => moveItem('products', categoryId, id, direction)} onUpdateCategory={(id, patch) => updateCategory('products', id, patch)} onUpdateItem={(categoryId, id, patch) => updateItem('products', categoryId, id, patch)} onDeleteCategory={category => setPendingConfirm({ kind: 'category', catalog: 'products', id: category.id, title: category.name })} onDeleteItem={(categoryId, item) => setPendingConfirm({ kind: 'item', catalog: 'products', categoryId, id: item.id, title: item.title })} onChooseImage={chooseImage} />}
        {tab === 'processes' && <CatalogEditor kind="processes" categories={content.processes.categories} selectedCategoryId={processCategoryId} selectedItemId={processItemId} resolveImage={resolveImage} onSelectCategory={id => { setProcessCategoryId(id); setProcessItemId(content.processes.categories.find(entry => entry.id === id)?.items[0]?.id || ''); }} onSelectItem={setProcessItemId} onAddCategory={() => addCategory('processes')} onAddItem={() => addItem('processes', processCategoryId)} onMoveCategory={(id, direction) => moveCategory('processes', id, direction)} onMoveItem={(categoryId, id, direction) => moveItem('processes', categoryId, id, direction)} onUpdateCategory={(id, patch) => updateCategory('processes', id, patch)} onUpdateItem={(categoryId, id, patch) => updateItem('processes', categoryId, id, patch)} onDeleteCategory={category => setPendingConfirm({ kind: 'category', catalog: 'processes', id: category.id, title: category.name })} onDeleteItem={(categoryId, item) => setPendingConfirm({ kind: 'item', catalog: 'processes', categoryId, id: item.id, title: item.title })} onChooseImage={chooseImage} />}

        {tab === 'quality' && <section className="showcase-quality-layout">
          <aside className="showcase-list-panel"><header><div><strong>质量项目</strong><small>只展示已核实或明确标记待核实的内容</small></div><button type="button" aria-label="新增质量项目" onClick={() => { const created = newQualityItem(); edit(draft => { draft.quality.items.push(created); }); setQualityId(created.id); }}><Plus /></button></header><div className="showcase-list-scroll">{content.quality.items.map((entry, index) => <button type="button" className={qualityItem?.id === entry.id ? 'active' : ''} key={entry.id} onClick={() => setQualityId(entry.id)}>{entry.image ? <WorkbenchImage src={resolveImage(entry.image)} alt="" /> : <span className="showcase-list-placeholder"><ShieldCheck /></span>}<span><strong>{entry.title}</strong><small>{entry.evidenceLabel || '依据未填写'} · {entry.visible ? '显示' : '隐藏'}</small></span><em>{String(index + 1).padStart(2, '0')}</em></button>)}</div></aside>
          <section className="showcase-form-panel">{qualityItem ? <div className="showcase-category-form"><header><div><span>QUALITY ITEM</span><h2>{qualityItem.title}</h2></div><label><input type="checkbox" checked={qualityItem.visible} onChange={event => edit(draft => { const target = draft.quality.items.find(entry => entry.id === qualityItem.id); if (target) target.visible = event.target.checked; })} />对外显示</label></header><div className="showcase-item-actions"><button type="button" className="danger" onClick={() => setPendingConfirm({ kind: 'quality', id: qualityItem.id, title: qualityItem.title })}><Trash2 />删除</button></div><div className="showcase-form-grid"><TextField label="项目名称" value={qualityItem.title} maxLength={80} onChange={value => edit(draft => { const target = draft.quality.items.find(entry => entry.id === qualityItem.id); if (target) target.title = value; })} /><TextField label="依据状态" value={qualityItem.evidenceLabel} maxLength={80} onChange={value => edit(draft => { const target = draft.quality.items.find(entry => entry.id === qualityItem.id); if (target) target.evidenceLabel = value; })} /><TextAreaField label="项目说明" value={qualityItem.summary} maxLength={400} onChange={value => edit(draft => { const target = draft.quality.items.find(entry => entry.id === qualityItem.id); if (target) target.summary = value; })} /><ImageField label="展示图片" image={qualityItem.image} imageAlt={qualityItem.imageAlt} resolve={resolveImage} onChoose={() => chooseImage('选择质量项目图片', ref => edit(draft => { const target = draft.quality.items.find(entry => entry.id === qualityItem.id); if (target) target.image = ref; }))} onAltChange={value => edit(draft => { const target = draft.quality.items.find(entry => entry.id === qualityItem.id); if (target) target.imageAlt = value; })} /></div></div> : <div className="showcase-empty-form"><ShieldCheck /><strong>建立质量项目</strong><span>对外声明前请准备可核实的设备、记录或标准依据。</span></div>}</section>
        </section>}

        {tab === 'publish' && <section className="showcase-publish-layout">
          <section className="showcase-publish-main">
            <header><div><span>PUBLISH & SHARE</span><h1>发布只读能力网页</h1><p>发布生成不可变版本；分享链接始终读取最新已发布版本，不读取未保存草稿。</p></div><button type="button" className="primary" onClick={publish} disabled={saving || dirty}><Globe2 />{publishedRevision ? '发布新版本' : '首次发布'}</button></header>
            <div className="showcase-publish-checks"><article className={!dirty ? 'ok' : ''}><CheckCircle2 /><div><strong>草稿已保存</strong><small>{dirty ? '仍有未保存修改，暂不可发布' : `当前草稿 V${draftRevision}`}</small></div></article><article className={content.sampleMode ? 'warning' : 'ok'}><ShieldCheck /><div><strong>{content.sampleMode ? '演示模式开启' : '已关闭演示提示'}</strong><small>{content.sampleMode ? '外部页面会明确标识素材与参数待核实' : '请确认所有内容已替换并核实'}</small></div></article><article className={publishedRevision ? 'ok' : ''}><Globe2 /><div><strong>{publishedRevision ? `已发布 V${publishedRevision}` : '尚未发布'}</strong><small>{formatDateTime(publishedAt)}</small></div></article></div>
            <div className="showcase-share-create"><div><h2>创建只读分享链接</h2><p>链接使用随机凭证且不会出现在公开目录。完整链接只在创建成功后显示一次；遗失时请创建新链接。</p></div><label><span>链接名称</span><input value={shareLabel} maxLength={80} onChange={event => setShareLabel(event.target.value)} /></label><label><span>有效期（天）</span><input value={shareDays} inputMode="numeric" placeholder="留空为长期" onChange={event => setShareDays(event.target.value.replace(/\D/g, '').slice(0, 4))} /></label><button type="button" onClick={createShare} disabled={saving || !publishedRevision}><Link2 />创建并复制</button></div>
            {createdShareUrl && <div className="showcase-created-link"><span>本次新链接</span><code>{createdShareUrl}</code><button type="button" onClick={() => copyText(createdShareUrl)}><Copy />复制</button><a href={createdShareUrl} target="_blank" rel="noreferrer"><ExternalLink />打开</a></div>}
            <div className="showcase-share-list"><header><strong>分享凭证</strong><small>仅展示前缀，数据库不保存可还原的完整链接</small></header>{shares.map(share => <article key={share.id} className={share.revokedAt ? 'revoked' : ''}><span className="showcase-share-icon"><Link2 /></span><div><strong>{share.label}</strong><small>凭证 {share.tokenPrefix}… · 创建于 {formatDateTime(share.createdAt)}</small><em>{share.revokedAt ? `已停用 ${formatDateTime(share.revokedAt)}` : share.expiresAt ? `有效至 ${formatDateTime(share.expiresAt)}` : '长期有效'}{share.lastAccessedAt ? ` · 最近访问 ${formatDateTime(share.lastAccessedAt)}` : ''}</em></div>{!share.revokedAt && <button type="button" onClick={() => setPendingConfirm({ kind: 'share', id: share.id, title: share.label })}>停用</button>}</article>)}{!shares.length && <div className="showcase-empty-small">发布后可创建第一个只读分享链接。</div>}</div>
          </section>
          <aside className="showcase-version-panel"><header><strong>发布历史</strong><small>最近 12 个不可变版本</small></header>{publications.map(publication => <article key={publication.id}><span>V{publication.revision}</span><div><strong>{publication.revision === publishedRevision ? '当前公开版本' : '历史版本'}</strong><small>{formatDateTime(publication.createdAt)}</small></div></article>)}{!publications.length && <div className="showcase-empty-small">尚无发布历史</div>}</aside>
        </section>}
      </>}
    </section>

    {previewOpen && content && <div className="showcase-preview-backdrop" role="dialog" aria-modal="true" aria-label="能力展厅草稿预览"><section><header><div><Eye /><span><strong>草稿预览</strong><small>此预览不会对外公开</small></span></div><button type="button" aria-label="关闭草稿预览" onClick={() => setPreviewOpen(false)}><X /></button></header><div className="showcase-preview-frame"><CapabilityShowcaseView content={content} mediaMode="draft" preview /></div></section></div>}

    {mediaOpen && <div className="showcase-media-backdrop" role="dialog" aria-modal="true" aria-label={mediaTitle}><section className="showcase-media-dialog"><header><div><FileImage /><span><strong>{mediaTitle}</strong><small>{mediaSelectionMode ? '选择图片后将应用到当前内容槽位' : '上传、查看和管理能力展厅图片'}</small></span></div><button type="button" aria-label="关闭素材库" onClick={closeMediaLibrary}><X /></button></header><div className="showcase-media-toolbar"><input ref={uploadInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event => uploadMedia(event.target.files?.[0])} /><button type="button" className="primary" disabled={uploading} onClick={() => uploadInputRef.current?.click()}><Upload />{uploading ? '上传中…' : '上传真实图片'}</button><span>JPG / PNG / WEBP，文件进入 S3 兼容对象存储</span></div><div className="showcase-media-scroll"><h3>当前上传素材</h3><div className="showcase-media-grid">{media.map(entry => <article key={entry.id}>{mediaSelectionMode ? <button type="button" className="showcase-media-preview" onClick={() => commitImage(`media:${entry.id}`)}><WorkbenchImage src={entry.contentUrl} alt={entry.altText || entry.displayName || entry.originalName} /><span>使用此图</span></button> : <div className="showcase-media-preview showcase-media-preview-static"><WorkbenchImage src={entry.contentUrl} alt={entry.altText || entry.displayName || entry.originalName} /></div>}<div><strong>{entry.displayName || entry.originalName}</strong><small>{(entry.size / 1024 / 1024).toFixed(1)} MB · {formatDateTime(entry.createdAt)}</small><button type="button" aria-label={`删除图片“${entry.displayName || entry.originalName}”`} onClick={() => setPendingConfirm({ kind: 'media', id: entry.id, title: entry.displayName || entry.originalName })}><Trash2 /></button></div></article>)}</div>{!media.length && <div className="showcase-empty-small">暂无上传图片。示例图片不会写入对象存储，真实上传图片会。</div>}<h3>内置演示素材</h3><div className="showcase-media-grid">{BUILT_IN_MEDIA.map(([label, ref]) => <article key={ref}>{mediaSelectionMode ? <button type="button" className="showcase-media-preview" onClick={() => commitImage(ref)}><WorkbenchImage src={ref} alt={label} /><span>使用此图</span></button> : <div className="showcase-media-preview showcase-media-preview-static"><WorkbenchImage src={ref} alt={label} /></div>}<div><strong>{label}</strong><small>AI 生成示例 · 可替换</small></div></article>)}</div></div></section></div>}

    <ConfirmDialog open={!!pendingConfirm} title={pendingConfirm?.kind === 'share' ? '停用分享链接？' : `确认删除“${pendingConfirm?.title || ''}”？`} description={pendingConfirm?.kind === 'share' ? '停用后，原只读链接立即失效；已经打开的页面刷新后也无法继续访问。' : pendingConfirm?.kind === 'media' ? '图片将执行软删除。若草稿或已发布版本仍在引用，系统会阻止删除。' : '此操作会修改当前草稿；保存前仍可通过刷新放弃本次修改。'} confirmLabel={pendingConfirm?.kind === 'share' ? '确认停用' : '确认删除'} danger busy={confirmBusy} onCancel={() => !confirmBusy && setPendingConfirm(null)} onConfirm={confirmPending} />
  </main>;
}
