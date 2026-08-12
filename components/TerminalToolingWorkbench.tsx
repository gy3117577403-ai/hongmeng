'use client';

import {
  Archive,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  Library,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWorkbenchHeader } from '@/components/layout/AppWorkbenchHeader';
import { useToastBridge } from '@/components/ToastProvider';
import type {
  CurrentUserDTO,
  TerminalToolingBladeDTO,
  TerminalToolingBladePositionDTO,
  TerminalToolingSetupDTO,
  TerminalToolingStatsDTO,
  TerminalToolingSupplyDTO,
  TerminalToolingTerminalDTO,
} from '@/types';

const POSITIONS: TerminalToolingBladePositionDTO[] = ['UPPER_OUTER', 'UPPER_INNER', 'LOWER_OUTER', 'LOWER_INNER'];
const POSITION_LABELS: Record<TerminalToolingBladePositionDTO, string> = {
  UPPER_OUTER: '上外刀',
  UPPER_INNER: '上内刀',
  LOWER_OUTER: '下外刀',
  LOWER_INNER: '下内刀',
};

type Tab = 'setups' | 'terminals' | 'blades';
type SupplyForm = { supplierName: string; supplierSku: string; productUrl: string; remark: string };
type SetupDraft = {
  id?: string;
  terminalId: string;
  name: string;
  wireRange: string;
  equipment: string;
  mold: string;
  remark: string;
  tags: string;
  lockVersion?: number;
  status?: TerminalToolingSetupDTO['status'];
  version?: number;
  positions: Record<TerminalToolingBladePositionDTO, string>;
};
type TerminalForm = {
  id?: string;
  specification: string;
  manufacturer: string;
  aliases: string;
  wireRange: string;
  material: string;
  plating: string;
  remark: string;
  isActive: boolean;
  lockVersion?: number;
  supplierLinks: SupplyForm[];
};
type BladeForm = {
  id?: string;
  model: string;
  manufacturer: string;
  compatiblePositions: TerminalToolingBladePositionDTO[];
  specification: string;
  dimensionA: string;
  dimensionB: string;
  dimensionUnit: string;
  material: string;
  hardness: string;
  remark: string;
  isActive: boolean;
  lockVersion?: number;
  supplierLinks: SupplyForm[];
};
type ImportPreview = {
  entity: 'terminals' | 'blades';
  fileName: string;
  rows: Array<Record<string, string> & { index: string; status: string; reason: string }>;
  summary: { total: number; ready: number; duplicate: number; invalid: number; skipped: number };
};

const emptyPositions = (): Record<TerminalToolingBladePositionDTO, string> => ({
  UPPER_OUTER: '',
  UPPER_INNER: '',
  LOWER_OUTER: '',
  LOWER_INNER: '',
});
const emptySupply = (): SupplyForm => ({ supplierName: '', supplierSku: '', productUrl: '', remark: '' });
const emptyStats: TerminalToolingStatsDTO = { terminalCount: 0, bladeCount: 0, publishedSetupCount: 0, draftSetupCount: 0, incompleteSetupCount: 0 };

function supplyForm(link: TerminalToolingSupplyDTO): SupplyForm {
  return {
    supplierName: link.supplierName,
    supplierSku: link.supplierSku || '',
    productUrl: link.productUrl || '',
    remark: link.remark || '',
  };
}

function terminalForm(item?: TerminalToolingTerminalDTO): TerminalForm {
  return item ? {
    id: item.id,
    specification: item.specification,
    manufacturer: item.manufacturer || '',
    aliases: item.aliases.join('；'),
    wireRange: item.wireRange || '',
    material: item.material || '',
    plating: item.plating || '',
    remark: item.remark || '',
    isActive: item.isActive,
    lockVersion: item.lockVersion,
    supplierLinks: item.supplierLinks.length ? item.supplierLinks.map(supplyForm) : [emptySupply()],
  } : {
    specification: '', manufacturer: '', aliases: '', wireRange: '', material: '', plating: '', remark: '', isActive: true, supplierLinks: [emptySupply()],
  };
}

function bladeForm(item?: TerminalToolingBladeDTO): BladeForm {
  return item ? {
    id: item.id,
    model: item.model,
    manufacturer: item.manufacturer || '',
    compatiblePositions: item.compatiblePositions,
    specification: item.specification || '',
    dimensionA: item.dimensionA || '',
    dimensionB: item.dimensionB || '',
    dimensionUnit: item.dimensionUnit || 'mm',
    material: item.material || '',
    hardness: item.hardness || '',
    remark: item.remark || '',
    isActive: item.isActive,
    lockVersion: item.lockVersion,
    supplierLinks: item.supplierLinks.length ? item.supplierLinks.map(supplyForm) : [emptySupply()],
  } : {
    model: '', manufacturer: '', compatiblePositions: [], specification: '', dimensionA: '', dimensionB: '', dimensionUnit: 'mm', material: '', hardness: '', remark: '', isActive: true, supplierLinks: [emptySupply()],
  };
}

function setupDraft(item: TerminalToolingSetupDTO): SetupDraft {
  const positions = emptyPositions();
  item.positions.forEach(position => { positions[position.position] = position.bladeId; });
  return {
    id: item.id,
    terminalId: item.terminalId,
    name: item.name || '',
    wireRange: item.wireRange || '',
    equipment: item.equipment || '',
    mold: item.mold || '',
    remark: item.remark || '',
    tags: item.tags.join('；'),
    lockVersion: item.lockVersion,
    status: item.status,
    version: item.version,
    positions,
  };
}

function newSetupDraft(terminal: TerminalToolingTerminalDTO): SetupDraft {
  return {
    terminalId: terminal.id,
    name: `${terminal.specification} 调模方案`,
    wireRange: terminal.wireRange || '',
    equipment: '', mold: '', remark: '', tags: '', positions: emptyPositions(), status: 'DRAFT',
  };
}

function statusLabel(status?: TerminalToolingSetupDTO['status']) {
  if (status === 'PUBLISHED') return '已发布';
  if (status === 'ARCHIVED') return '历史版本';
  return '草稿';
}

function dateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replace(/\//g, '-');
}

async function responseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function SupplyEditor({ value, disabled, onChange }: { value: SupplyForm[]; disabled: boolean; onChange: (value: SupplyForm[]) => void }) {
  function update(index: number, key: keyof SupplyForm, nextValue: string) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: nextValue } : item));
  }
  return (
    <div className="tooling-supply-editor">
      <div className="tooling-supply-heading"><span>供应商与采购链接</span>{!disabled && <button type="button" onClick={() => onChange([...value, emptySupply()])}><Plus />添加来源</button>}</div>
      {value.map((item, index) => (
        <div className="tooling-supply-row" key={`supply-${index}`}>
          <input disabled={disabled} value={item.supplierName} onChange={event => update(index, 'supplierName', event.target.value)} placeholder="供应商名称" />
          <input disabled={disabled} value={item.supplierSku} onChange={event => update(index, 'supplierSku', event.target.value)} placeholder="供应商货号" />
          <input disabled={disabled} value={item.productUrl} onChange={event => update(index, 'productUrl', event.target.value)} placeholder="https://商品链接" />
          {!disabled && <button type="button" aria-label="移除供应商" onClick={() => onChange(value.length === 1 ? [emptySupply()] : value.filter((_, itemIndex) => itemIndex !== index))}><X /></button>}
        </div>
      ))}
    </div>
  );
}

export function TerminalToolingWorkbench({ user }: { user: CurrentUserDTO }) {
  const [tab, setTab] = useState<Tab>('setups');
  const [terminals, setTerminals] = useState<TerminalToolingTerminalDTO[]>([]);
  const [blades, setBlades] = useState<TerminalToolingBladeDTO[]>([]);
  const [setups, setSetups] = useState<TerminalToolingSetupDTO[]>([]);
  const [stats, setStats] = useState<TerminalToolingStatsDTO>(emptyStats);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  useToastBridge(message, setMessage);
  const [terminalSearch, setTerminalSearch] = useState('');
  const [bladeSearch, setBladeSearch] = useState('');
  const [selectedTerminalId, setSelectedTerminalId] = useState('');
  const [selectedSetupId, setSelectedSetupId] = useState('');
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [terminalModal, setTerminalModal] = useState<TerminalForm | null>(null);
  const [bladeModal, setBladeModal] = useState<BladeForm | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importEntity, setImportEntity] = useState<'terminals' | 'blades'>('terminals');
  const importInputRef = useRef<HTMLInputElement>(null);

  const capabilities = new Set(user.access.capabilities || []);
  const canCreate = capabilities.has('TERMINAL_TOOLING:CREATE');
  const canUpdate = capabilities.has('TERMINAL_TOOLING:UPDATE');
  const canPublish = capabilities.has('TERMINAL_TOOLING:EXECUTE_WORKFLOW');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [terminalResponse, bladeResponse, setupResponse, overviewResponse] = await Promise.all([
        fetch('/api/terminal-tooling/terminals', { cache: 'no-store' }),
        fetch('/api/terminal-tooling/blades', { cache: 'no-store' }),
        fetch('/api/terminal-tooling/setups', { cache: 'no-store' }),
        fetch('/api/terminal-tooling/overview', { cache: 'no-store' }),
      ]);
      const [terminalData, bladeData, setupData, overviewData] = await Promise.all([responseJson(terminalResponse), responseJson(bladeResponse), responseJson(setupResponse), responseJson(overviewResponse)]);
      if (!terminalResponse.ok || !bladeResponse.ok || !setupResponse.ok || !overviewResponse.ok) {
        setMessage(String(terminalData.error || bladeData.error || setupData.error || overviewData.error || '端子调模资料加载失败'));
        return;
      }
      setTerminals(Array.isArray(terminalData.terminals) ? terminalData.terminals as TerminalToolingTerminalDTO[] : []);
      setBlades(Array.isArray(bladeData.blades) ? bladeData.blades as TerminalToolingBladeDTO[] : []);
      setSetups(Array.isArray(setupData.setups) ? setupData.setups as TerminalToolingSetupDTO[] : []);
      setStats((overviewData.stats || emptyStats) as TerminalToolingStatsDTO);
      setTagOptions(Array.isArray(overviewData.tags) ? overviewData.tags as string[] : []);
    } catch {
      setMessage('端子调模资料加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const activeTerminals = useMemo(() => terminals.filter(item => item.isActive), [terminals]);
  const visibleTerminals = useMemo(() => {
    const keyword = terminalSearch.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return terminals;
    return terminals.filter(item => [item.specification, item.manufacturer, item.wireRange, ...item.aliases, ...item.supplierLinks.map(link => link.supplierName)].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword)));
  }, [terminalSearch, terminals]);
  const visibleBlades = useMemo(() => {
    const keyword = bladeSearch.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return blades;
    return blades.filter(item => [item.model, item.manufacturer, item.specification, item.material, ...item.supplierLinks.map(link => link.supplierName)].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword)));
  }, [bladeSearch, blades]);
  const terminalVersions = useMemo(() => setups.filter(item => item.terminalId === selectedTerminalId).sort((a, b) => b.version - a.version), [selectedTerminalId, setups]);
  const selectedSetup = useMemo(() => setups.find(item => item.id === selectedSetupId) || null, [selectedSetupId, setups]);
  const selectedTerminal = useMemo(() => terminals.find(item => item.id === selectedTerminalId) || null, [selectedTerminalId, terminals]);

  useEffect(() => {
    if (!selectedTerminalId && activeTerminals[0]) setSelectedTerminalId(activeTerminals[0].id);
  }, [activeTerminals, selectedTerminalId]);

  useEffect(() => {
    if (!selectedTerminalId) return;
    if (draft?.terminalId === selectedTerminalId) return;
    const versions = setups.filter(item => item.terminalId === selectedTerminalId).sort((a, b) => b.version - a.version);
    const preferred = versions.find(item => item.status === 'DRAFT') || versions.find(item => item.status === 'PUBLISHED') || versions[0];
    if (preferred) {
      setSelectedSetupId(preferred.id);
      setDraft(setupDraft(preferred));
    } else {
      const terminal = terminals.find(item => item.id === selectedTerminalId);
      setSelectedSetupId('');
      setDraft(terminal && canCreate ? newSetupDraft(terminal) : null);
    }
  }, [canCreate, draft?.terminalId, selectedTerminalId, setups, terminals]);

  const baselineDraft = selectedSetup ? setupDraft(selectedSetup) : null;
  const draftDirty = !!draft && JSON.stringify(draft) !== JSON.stringify(baselineDraft);
  const setupReadOnly = !draft || !canUpdate || draft.status !== 'DRAFT';
  const completePositionCount = draft ? POSITIONS.filter(position => draft.positions[position]).length : 0;

  function chooseTerminal(id: string) {
    if (draftDirty && !window.confirm('当前调模方案有未保存修改，确定切换端子吗？')) return;
    setSelectedTerminalId(id);
    setSelectedSetupId('');
    setDraft(null);
  }

  function chooseSetup(item: TerminalToolingSetupDTO) {
    if (draftDirty && !window.confirm('当前调模方案有未保存修改，确定切换版本吗？')) return;
    setSelectedSetupId(item.id);
    setDraft(setupDraft(item));
  }

  function startNewSetup() {
    if (!selectedTerminal || !canCreate) return;
    if (draftDirty && !window.confirm('当前调模方案有未保存修改，确定新建方案吗？')) return;
    setSelectedSetupId('');
    setDraft(newSetupDraft(selectedTerminal));
  }

  async function saveSetup() {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const payload = {
        terminalId: draft.terminalId,
        name: draft.name,
        wireRange: draft.wireRange,
        equipment: draft.equipment,
        mold: draft.mold,
        remark: draft.remark,
        tags: draft.tags,
        positions: POSITIONS.filter(position => draft.positions[position]).map(position => ({ position, bladeId: draft.positions[position] })),
        ...(draft.id ? { lockVersion: draft.lockVersion } : {}),
      };
      const response = await fetch(draft.id ? `/api/terminal-tooling/setups/${draft.id}` : '/api/terminal-tooling/setups', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await responseJson(response);
      if (!response.ok) { setMessage(String(data.error || '调模方案保存失败')); return; }
      const saved = data.setup as TerminalToolingSetupDTO;
      setMessage(draft.id ? '调模方案已保存' : '调模草稿已创建');
      await loadAll();
      setSelectedTerminalId(saved.terminalId);
      setSelectedSetupId(saved.id);
      setDraft(setupDraft(saved));
    } finally {
      setSaving(false);
    }
  }

  async function publishSetup() {
    if (!draft?.id || !canPublish || saving) return;
    if (draftDirty) { setMessage('请先保存当前修改，再发布方案'); return; }
    if (completePositionCount !== 4) { setMessage('四个刀位配齐后才能发布'); return; }
    if (!window.confirm(`确认发布 V${draft.version}？同条件下当前正式版本将转为历史版本。`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/terminal-tooling/setups/${draft.id}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lockVersion: draft.lockVersion }),
      });
      const data = await responseJson(response);
      if (!response.ok) { setMessage(String(data.error || '发布失败')); return; }
      const published = data.setup as TerminalToolingSetupDTO;
      setMessage(`V${published.version} 已发布`);
      await loadAll();
      setSelectedSetupId(published.id);
      setDraft(setupDraft(published));
    } finally { setSaving(false); }
  }

  async function duplicateSetup() {
    if (!draft?.id || !canCreate || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/terminal-tooling/setups/${draft.id}/duplicate`, { method: 'POST' });
      const data = await responseJson(response);
      if (!response.ok) { setMessage(String(data.error || '复制失败')); return; }
      const copied = data.setup as TerminalToolingSetupDTO;
      setMessage(`已复制为 V${copied.version} 草稿`);
      await loadAll();
      setSelectedSetupId(copied.id);
      setDraft(setupDraft(copied));
    } finally { setSaving(false); }
  }

  async function saveTerminal() {
    if (!terminalModal || saving) return;
    setSaving(true);
    try {
      const response = await fetch(terminalModal.id ? `/api/terminal-tooling/terminals/${terminalModal.id}` : '/api/terminal-tooling/terminals', {
        method: terminalModal.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(terminalModal),
      });
      const data = await responseJson(response);
      if (!response.ok) { setMessage(String(data.error || '端子保存失败')); return; }
      setMessage(terminalModal.id ? '端子资料已更新' : '端子已加入端子库');
      setTerminalModal(null);
      await loadAll();
    } finally { setSaving(false); }
  }

  async function saveBlade() {
    if (!bladeModal || saving) return;
    setSaving(true);
    try {
      const response = await fetch(bladeModal.id ? `/api/terminal-tooling/blades/${bladeModal.id}` : '/api/terminal-tooling/blades', {
        method: bladeModal.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bladeModal),
      });
      const data = await responseJson(response);
      if (!response.ok) { setMessage(String(data.error || '刀片保存失败')); return; }
      setMessage(bladeModal.id ? '刀片资料已更新' : '刀片已加入刀片库');
      setBladeModal(null);
      await loadAll();
    } finally { setSaving(false); }
  }

  async function toggleTerminal(item: TerminalToolingTerminalDTO) {
    const response = await fetch(`/api/terminal-tooling/terminals/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...terminalForm(item), isActive: !item.isActive }),
    });
    const data = await responseJson(response);
    if (!response.ok) setMessage(String(data.error || '端子状态更新失败'));
    else { setMessage(item.isActive ? '端子已停用，历史方案仍保留' : '端子已启用'); await loadAll(); }
  }

  async function toggleBlade(item: TerminalToolingBladeDTO) {
    const response = await fetch(`/api/terminal-tooling/blades/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bladeForm(item), isActive: !item.isActive }),
    });
    const data = await responseJson(response);
    if (!response.ok) setMessage(String(data.error || '刀片状态更新失败'));
    else { setMessage(item.isActive ? '刀片已停用，历史引用仍保留' : '刀片已启用'); await loadAll(); }
  }

  async function handleImportFile(file?: File) {
    if (!file) return;
    const form = new FormData();
    form.set('entity', importEntity);
    form.set('file', file);
    setSaving(true);
    try {
      const response = await fetch('/api/terminal-tooling/import/preview', { method: 'POST', body: form });
      const data = await responseJson(response);
      if (!response.ok) { setMessage(String(data.error || '导入预览失败')); return; }
      setImportPreview(data as unknown as ImportPreview);
    } finally {
      setSaving(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function confirmImport() {
    if (!importPreview || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/terminal-tooling/import/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(importPreview),
      });
      const data = await responseJson(response);
      if (!response.ok) { setMessage(String(data.error || '导入失败')); return; }
      const summary = data.summary as { created?: number; skipped?: number; failed?: number };
      setMessage(`导入完成：新增 ${summary.created || 0}，跳过 ${summary.skipped || 0}，失败 ${summary.failed || 0}`);
      setImportPreview(null);
      await loadAll();
    } finally { setSaving(false); }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.href = '/login';
  }

  function openImport(entity: 'terminals' | 'blades') {
    setImportEntity(entity);
    setTimeout(() => importInputRef.current?.click(), 0);
  }

  function bladeOptions(position: TerminalToolingBladePositionDTO, selectedId: string) {
    return blades.filter(blade => blade.compatiblePositions.includes(position) && (blade.isActive || blade.id === selectedId));
  }

  return (
    <main className="tooling-page hm-workbench-root">
      <AppWorkbenchHeader
        user={user}
        activeHref="/workspace/terminal-tooling"
        subtitle="端子、四刀位与调模版本标准库"
        menuItems={[{ label: '刷新资料', onSelect: loadAll }, { label: '返回首页', href: '/home' }, { label: '退出登录', onSelect: logout }]}
      />
      <input ref={importInputRef} hidden type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={event => handleImportFile(event.target.files?.[0])} />

      <section className="tooling-command-bar">
        <div className="tooling-tabs" role="tablist" aria-label="端子调模模块">
          <button className={tab === 'setups' ? 'active' : ''} type="button" onClick={() => setTab('setups')}><Settings2 />调模台</button>
          <button className={tab === 'terminals' ? 'active' : ''} type="button" onClick={() => setTab('terminals')}><Library />端子库 <small>{stats.terminalCount}</small></button>
          <button className={tab === 'blades' ? 'active' : ''} type="button" onClick={() => setTab('blades')}><Wrench />刀片库 <small>{stats.bladeCount}</small></button>
        </div>
        <button type="button" className="tooling-refresh" onClick={loadAll} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} />刷新</button>
      </section>

      <section className="tooling-stats" aria-label="端子调模数据概览">
        <article><span>有效端子</span><strong>{stats.terminalCount}</strong><small>种规格</small></article>
        <article><span>有效刀片</span><strong>{stats.bladeCount}</strong><small>个型号</small></article>
        <article><span>正式方案</span><strong>{stats.publishedSetupCount}</strong><small>套</small></article>
        <article><span>待完善草稿</span><strong>{stats.incompleteSetupCount}</strong><small>套</small></article>
      </section>

      {tab === 'setups' && (
        <section className="tooling-setup-layout">
          <aside className="tooling-terminal-rail">
            <div className="tooling-panel-title"><div><strong>选择端子</strong><small>规格与制造商共同识别</small></div>{canCreate && <button type="button" onClick={() => setTerminalModal(terminalForm())}><Plus /></button>}</div>
            <label className="tooling-search"><Search /><input value={terminalSearch} onChange={event => setTerminalSearch(event.target.value)} placeholder="搜索规格、品牌或供应商" /></label>
            <div className="tooling-terminal-list">
              {visibleTerminals.filter(item => item.isActive).map(item => (
                <button type="button" className={item.id === selectedTerminalId ? 'active' : ''} key={item.id} onClick={() => chooseTerminal(item.id)}>
                  <span><strong>{item.specification}</strong><small>{item.manufacturer || '制造商未设置'}</small></span>
                  <em>{item.publishedSetupCount ? `${item.publishedSetupCount} 套正式` : '暂无正式方案'}</em>
                </button>
              ))}
              {!loading && !visibleTerminals.some(item => item.isActive) && <div className="tooling-empty-small">尚无有效端子，请先建立端子库。</div>}
            </div>
          </aside>

          <section className="tooling-setup-editor">
            {!draft ? <div className="tooling-empty"><Settings2 /><strong>选择一个端子开始调模</strong><span>调模方案会保存四个刀位、适用条件和历史版本。</span></div> : <>
              <header className="tooling-editor-header">
                <div><span className={`tooling-status ${draft.status?.toLocaleLowerCase()}`}>{statusLabel(draft.status)}</span><h1>{selectedTerminal?.specification || '端子'} · {draft.id ? `V${draft.version}` : '新草稿'}</h1><p>{selectedTerminal?.manufacturer || '制造商未设置'} · {completePositionCount}/4 个刀位已配置</p></div>
                <div className="tooling-editor-actions">
                  {draft.status !== 'DRAFT' && canCreate && <button type="button" onClick={duplicateSetup} disabled={saving}><Copy />复制为新版本</button>}
                  {draft.status === 'DRAFT' && canUpdate && <button type="button" onClick={saveSetup} disabled={saving || !draftDirty}><Save />保存草稿</button>}
                  {draft.status === 'DRAFT' && canPublish && <button type="button" className="primary" onClick={publishSetup} disabled={saving || !draft.id || draftDirty || completePositionCount !== 4} title={!draft.id || draftDirty ? '请先保存当前草稿' : completePositionCount !== 4 ? '请先配置四个刀位' : '发布为正式方案'}><CheckCircle2 />发布方案</button>}
                </div>
              </header>

              <div className="tooling-context-fields">
                <label><span>方案名称</span><input disabled={setupReadOnly} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：10075 半自动压接" /></label>
                <label><span>适用线径</span><input disabled={setupReadOnly} value={draft.wireRange} onChange={event => setDraft({ ...draft, wireRange: event.target.value })} placeholder="例如：0.5–0.75 mm²" /></label>
                <label><span>压接设备</span><input disabled={setupReadOnly} value={draft.equipment} onChange={event => setDraft({ ...draft, equipment: event.target.value })} placeholder="例如：半自动压接机 A" /></label>
                <label><span>模具</span><input disabled={setupReadOnly} value={draft.mold} onChange={event => setDraft({ ...draft, mold: event.target.value })} placeholder="例如：单模具 M01" /></label>
              </div>

              <div className="tooling-position-grid">
                {POSITIONS.map(position => {
                  const selectedBlade = blades.find(blade => blade.id === draft.positions[position]);
                  return <article className={selectedBlade ? 'complete' : ''} key={position}>
                    <div><span>{POSITION_LABELS[position]}</span>{selectedBlade ? <CheckCircle2 /> : <Wrench />}</div>
                    <select disabled={setupReadOnly} value={draft.positions[position]} onChange={event => setDraft({ ...draft, positions: { ...draft.positions, [position]: event.target.value } })}>
                      <option value="">选择刀片型号</option>
                      {bladeOptions(position, draft.positions[position]).map(blade => <option key={blade.id} value={blade.id}>{blade.model} · {blade.specification || '规格未设置'}{blade.manufacturer ? ` · ${blade.manufacturer}` : ''}</option>)}
                    </select>
                    {selectedBlade ? <p><strong>{selectedBlade.model}</strong><span>{selectedBlade.specification || [selectedBlade.dimensionA, selectedBlade.dimensionB].filter(Boolean).join('×') || '规格未设置'}</span><small>{selectedBlade.supplierLinks[0]?.supplierName || '供应商未设置'}</small></p> : <p className="missing"><span>尚未配置</span><small>只能选择兼容此刀位的有效刀片</small></p>}
                  </article>;
                })}
              </div>

              <section className="tooling-notes">
                <label><span>自定义标签</span><input disabled={setupReadOnly} value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })} placeholder="垫纸；半自动压接；单模具" /></label>
                {!!tagOptions.length && !setupReadOnly && <div className="tooling-tag-options">{tagOptions.slice(0, 12).map(tag => <button key={tag} type="button" onClick={() => { const current = draft.tags.split(/[；;,，]/).map(value => value.trim()).filter(Boolean); if (!current.includes(tag)) setDraft({ ...draft, tags: [...current, tag].join('；') }); }}>{tag}</button>)}</div>}
                <label><span>调模备注</span><textarea disabled={setupReadOnly} value={draft.remark} onChange={event => setDraft({ ...draft, remark: event.target.value })} placeholder="记录垫纸位置、压接方式、注意事项或现场调整依据" /></label>
              </section>

              {draft.status === 'DRAFT' && canUpdate && <footer className="tooling-save-strip"><span>{draftDirty ? '有未保存修改' : '草稿已保存'} · 发布后不可直接覆盖</span><button type="button" className="primary" onClick={saveSetup} disabled={saving || !draftDirty}><Save />保存当前草稿</button></footer>}
            </>}
          </section>

          <aside className="tooling-version-rail">
            <div className="tooling-panel-title"><div><strong>方案版本</strong><small>{selectedTerminal ? `${terminalVersions.length} 个历史记录` : '请选择端子'}</small></div>{selectedTerminal && canCreate && <button type="button" onClick={startNewSetup}><Plus /></button>}</div>
            <div className="tooling-version-list">
              {terminalVersions.map(item => <button type="button" className={item.id === selectedSetupId ? 'active' : ''} key={item.id} onClick={() => chooseSetup(item)}>
                <span><strong>V{item.version}</strong><em className={item.status.toLocaleLowerCase()}>{statusLabel(item.status)}</em></span>
                <b>{item.name || '未命名方案'}</b>
                <small>{[item.wireRange, item.equipment, item.mold].filter(Boolean).join(' · ') || '默认适用条件'}</small>
                <small>更新 {dateTime(item.updatedAt)}</small>
              </button>)}
              {selectedTerminal && !terminalVersions.length && <div className="tooling-empty-small">这个端子还没有调模记录。</div>}
            </div>
            <div className="tooling-release-rule"><ShieldCheck /><div><strong>版本规则</strong><p>发布新版本时，同一端子、线径、设备和模具下的旧正式版本自动归档，历史记录不会被覆盖。</p></div></div>
          </aside>
        </section>
      )}

      {tab === 'terminals' && (
        <section className="tooling-library-panel">
          <header><div><h1>端子库</h1><p>规格与制造商共同识别一个端子，可维护多个采购来源。</p></div><div className="tooling-library-actions"><a href="/api/terminal-tooling/export.csv?entity=terminals"><Download />导出 CSV</a>{canCreate && <button type="button" onClick={() => openImport('terminals')}><FileUp />导入</button>}{canCreate && <button type="button" className="primary" onClick={() => setTerminalModal(terminalForm())}><Plus />新增端子</button>}</div></header>
          <label className="tooling-library-search"><Search /><input value={terminalSearch} onChange={event => setTerminalSearch(event.target.value)} placeholder="搜索端子规格、制造商、线径或供应商" /><span>{visibleTerminals.length} 条</span></label>
          <div className="tooling-table-wrap"><table><thead><tr><th>端子规格</th><th>制造商 / 别名</th><th>适用线径</th><th>供应商</th><th>调模方案</th><th>状态</th><th>操作</th></tr></thead><tbody>
            {visibleTerminals.map(item => <tr key={item.id} className={!item.isActive ? 'inactive' : ''}><td><strong>{item.specification}</strong><small>{item.material || '-'} · {item.plating || '-'}</small></td><td>{item.manufacturer || '-'}<small>{item.aliases.join('、') || '无别名'}</small></td><td>{item.wireRange || '-'}</td><td>{item.supplierLinks[0] ? <span>{item.supplierLinks[0].supplierName}{item.supplierLinks[0].productUrl && <a href={item.supplierLinks[0].productUrl} target="_blank" rel="noreferrer"><ExternalLink /></a>}<small>{item.supplierLinks[0].supplierSku || '货号未设置'}</small></span> : '-'}</td><td>{item.publishedSetupCount} 正式 / {item.setupCount} 总计</td><td><em className={item.isActive ? 'active' : 'disabled'}>{item.isActive ? '正常' : '停用'}</em></td><td><div className="tooling-row-actions"><button type="button" onClick={() => setTerminalModal(terminalForm(item))}>{canUpdate ? '编辑' : '查看'}</button>{canUpdate && <button type="button" onClick={() => toggleTerminal(item)}>{item.isActive ? '停用' : '启用'}</button>}</div></td></tr>)}
          </tbody></table></div>
        </section>
      )}

      {tab === 'blades' && (
        <section className="tooling-library-panel">
          <header><div><h1>刀片库</h1><p>保存刀片型号、原始规格、适用刀位和采购来源。</p></div><div className="tooling-library-actions"><a href="/api/terminal-tooling/export.csv?entity=blades"><Download />导出 CSV</a>{canCreate && <button type="button" onClick={() => openImport('blades')}><FileUp />导入</button>}{canCreate && <button type="button" className="primary" onClick={() => setBladeModal(bladeForm())}><Plus />新增刀片</button>}</div></header>
          <label className="tooling-library-search"><Search /><input value={bladeSearch} onChange={event => setBladeSearch(event.target.value)} placeholder="搜索刀片型号、规格、材质或供应商" /><span>{visibleBlades.length} 条</span></label>
          <div className="tooling-table-wrap"><table><thead><tr><th>刀片型号</th><th>适用刀位</th><th>规格 / 尺寸</th><th>供应商</th><th>引用</th><th>状态</th><th>操作</th></tr></thead><tbody>
            {visibleBlades.map(item => <tr key={item.id} className={!item.isActive ? 'inactive' : ''}><td><strong>{item.model}</strong><small>{item.manufacturer || '制造商未设置'}</small></td><td><div className="tooling-position-tags">{item.compatiblePositions.map(position => <span key={position}>{POSITION_LABELS[position]}</span>)}</div></td><td>{item.specification || [item.dimensionA, item.dimensionB].filter(Boolean).join('×') || '-'}<small>{item.material || '-'} · {item.hardness || '-'}</small></td><td>{item.supplierLinks[0] ? <span>{item.supplierLinks[0].supplierName}{item.supplierLinks[0].productUrl && <a href={item.supplierLinks[0].productUrl} target="_blank" rel="noreferrer"><ExternalLink /></a>}<small>{item.supplierLinks[0].supplierSku || '货号未设置'}</small></span> : '-'}</td><td>{item.usageCount} 套方案</td><td><em className={item.isActive ? 'active' : 'disabled'}>{item.isActive ? '正常' : '停用'}</em></td><td><div className="tooling-row-actions"><button type="button" onClick={() => setBladeModal(bladeForm(item))}>{canUpdate ? '编辑' : '查看'}</button>{canUpdate && <button type="button" onClick={() => toggleBlade(item)}>{item.isActive ? '停用' : '启用'}</button>}</div></td></tr>)}
          </tbody></table></div>
        </section>
      )}

      {terminalModal && <div className="tooling-modal-backdrop" role="presentation"><section className="tooling-modal" role="dialog" aria-modal="true" aria-label={terminalModal.id ? '编辑端子' : '新增端子'}><header><div><h2>{terminalModal.id ? '编辑端子' : '新增端子'}</h2><p>端子规格与制造商组合不可重复</p></div><button type="button" onClick={() => setTerminalModal(null)}><X /></button></header><div className="tooling-modal-body"><div className="tooling-form-grid"><label><span>端子规格 *</span><input disabled={!canUpdate && !!terminalModal.id} value={terminalModal.specification} onChange={event => setTerminalModal({ ...terminalModal, specification: event.target.value })} placeholder="例如：10075" /></label><label><span>制造商 / 品牌</span><input disabled={!canUpdate && !!terminalModal.id} value={terminalModal.manufacturer} onChange={event => setTerminalModal({ ...terminalModal, manufacturer: event.target.value })} /></label><label><span>适用线径</span><input disabled={!canUpdate && !!terminalModal.id} value={terminalModal.wireRange} onChange={event => setTerminalModal({ ...terminalModal, wireRange: event.target.value })} placeholder="例如：0.5–0.75 mm²" /></label><label><span>别名</span><input disabled={!canUpdate && !!terminalModal.id} value={terminalModal.aliases} onChange={event => setTerminalModal({ ...terminalModal, aliases: event.target.value })} placeholder="用分号分隔" /></label><label><span>材质</span><input disabled={!canUpdate && !!terminalModal.id} value={terminalModal.material} onChange={event => setTerminalModal({ ...terminalModal, material: event.target.value })} /></label><label><span>镀层</span><input disabled={!canUpdate && !!terminalModal.id} value={terminalModal.plating} onChange={event => setTerminalModal({ ...terminalModal, plating: event.target.value })} /></label></div><SupplyEditor value={terminalModal.supplierLinks} disabled={!canUpdate && !!terminalModal.id} onChange={supplierLinks => setTerminalModal({ ...terminalModal, supplierLinks })} /><label className="tooling-wide-field"><span>备注</span><textarea disabled={!canUpdate && !!terminalModal.id} value={terminalModal.remark} onChange={event => setTerminalModal({ ...terminalModal, remark: event.target.value })} /></label></div><footer><button type="button" onClick={() => setTerminalModal(null)}>取消</button>{(terminalModal.id ? canUpdate : canCreate) && <button type="button" className="primary" disabled={saving || !terminalModal.specification.trim()} onClick={saveTerminal}><Save />保存端子</button>}</footer></section></div>}

      {bladeModal && <div className="tooling-modal-backdrop" role="presentation"><section className="tooling-modal" role="dialog" aria-modal="true" aria-label={bladeModal.id ? '编辑刀片' : '新增刀片'}><header><div><h2>{bladeModal.id ? '编辑刀片' : '新增刀片'}</h2><p>规格原文与结构化尺寸同时保留</p></div><button type="button" onClick={() => setBladeModal(null)}><X /></button></header><div className="tooling-modal-body"><div className="tooling-form-grid"><label><span>刀片型号 *</span><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.model} onChange={event => setBladeModal({ ...bladeModal, model: event.target.value })} /></label><label><span>制造商 / 品牌</span><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.manufacturer} onChange={event => setBladeModal({ ...bladeModal, manufacturer: event.target.value })} /></label><label className="full"><span>适用刀位 *</span><div className="tooling-position-checks">{POSITIONS.map(position => <button type="button" disabled={!canUpdate && !!bladeModal.id} className={bladeModal.compatiblePositions.includes(position) ? 'active' : ''} key={position} onClick={() => setBladeModal({ ...bladeModal, compatiblePositions: bladeModal.compatiblePositions.includes(position) ? bladeModal.compatiblePositions.filter(value => value !== position) : [...bladeModal.compatiblePositions, position] })}>{POSITION_LABELS[position]}</button>)}</div></label><label><span>规格原文</span><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.specification} onChange={event => setBladeModal({ ...bladeModal, specification: event.target.value })} placeholder="例如：2.4×1.5" /></label><label><span>尺寸A / 尺寸B</span><div className="tooling-dimension-fields"><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.dimensionA} onChange={event => setBladeModal({ ...bladeModal, dimensionA: event.target.value })} placeholder="2.4" /><b>×</b><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.dimensionB} onChange={event => setBladeModal({ ...bladeModal, dimensionB: event.target.value })} placeholder="1.5" /><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.dimensionUnit} onChange={event => setBladeModal({ ...bladeModal, dimensionUnit: event.target.value })} placeholder="mm" /></div></label><label><span>材质</span><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.material} onChange={event => setBladeModal({ ...bladeModal, material: event.target.value })} /></label><label><span>硬度</span><input disabled={!canUpdate && !!bladeModal.id} value={bladeModal.hardness} onChange={event => setBladeModal({ ...bladeModal, hardness: event.target.value })} /></label></div><SupplyEditor value={bladeModal.supplierLinks} disabled={!canUpdate && !!bladeModal.id} onChange={supplierLinks => setBladeModal({ ...bladeModal, supplierLinks })} /><label className="tooling-wide-field"><span>备注</span><textarea disabled={!canUpdate && !!bladeModal.id} value={bladeModal.remark} onChange={event => setBladeModal({ ...bladeModal, remark: event.target.value })} /></label></div><footer><button type="button" onClick={() => setBladeModal(null)}>取消</button>{(bladeModal.id ? canUpdate : canCreate) && <button type="button" className="primary" disabled={saving || !bladeModal.model.trim() || !bladeModal.compatiblePositions.length} onClick={saveBlade}><Save />保存刀片</button>}</footer></section></div>}

      {importPreview && <div className="tooling-modal-backdrop" role="presentation"><section className="tooling-modal tooling-import-modal" role="dialog" aria-modal="true"><header><div><h2>确认导入{importPreview.entity === 'terminals' ? '端子库' : '刀片库'}</h2><p>{importPreview.fileName}</p></div><button type="button" onClick={() => setImportPreview(null)}><X /></button></header><div className="tooling-import-summary"><span>总行数 <strong>{importPreview.summary.total}</strong></span><span>可导入 <strong>{importPreview.summary.ready}</strong></span><span>重复 <strong>{importPreview.summary.duplicate}</strong></span><span>无效 <strong>{importPreview.summary.invalid}</strong></span></div><div className="tooling-import-list">{importPreview.rows.slice(0, 50).map(row => <div key={row.index}><span>第 {row.index} 行</span><strong>{importPreview.entity === 'terminals' ? (row.specification || '-') : (row.model || '-')}</strong><em className={row.status}>{row.status === 'ready' ? '可导入' : row.status === 'duplicate' ? '重复' : row.status === 'invalid' ? '无效' : '跳过'}</em><small>{row.reason || '校验通过'}</small></div>)}</div><footer><button type="button" onClick={() => setImportPreview(null)}>取消</button><button type="button" className="primary" disabled={saving || !importPreview.summary.ready} onClick={confirmImport}><FileUp />导入 {importPreview.summary.ready} 条</button></footer></section></div>}

      {loading && <div className="tooling-loading"><RefreshCw className="spin" />正在加载端子调模资料</div>}
    </main>
  );
}
