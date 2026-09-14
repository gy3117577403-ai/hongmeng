'use client';

import { Check, CheckCircle2, ChevronRight, Grid2X2, Plus, Save, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { TerminalToolingBladeDTO, TerminalToolingBladePositionDTO, TerminalToolingBladeSpecDTO } from '@/types';

export const BLADE_POSITIONS: TerminalToolingBladePositionDTO[] = ['UPPER_OUTER', 'UPPER_INNER', 'LOWER_OUTER', 'LOWER_INNER'];
export const BLADE_LABELS = { UPPER_OUTER: '上外刀', UPPER_INNER: '上内刀', LOWER_OUTER: '下外刀', LOWER_INNER: '下内刀' };
type Supply = { supplierName: string; supplierSku: string; productUrl: string; remark: string };
type SpecForm = { position: TerminalToolingBladePositionDTO; specification: string; dimensionA: string; dimensionB: string; dimensionUnit: string; material: string; hardness: string; remark: string; needsReview: boolean; supplierLinks: Supply[] };
export type TerminalBladeForm = { id?: string; lockVersion?: number; model: string; manufacturer: string; remark: string; isActive: boolean; isDraft: boolean; positionSpecs: SpecForm[] };

export function bladeSpec(item: TerminalToolingBladeDTO | undefined, position: TerminalToolingBladePositionDTO): TerminalToolingBladeSpecDTO | undefined {
  return item?.positionSpecs.find(spec => spec.position === position);
}
export function bladeSpecification(item: TerminalToolingBladeDTO | undefined, position: TerminalToolingBladePositionDTO) {
  const spec = bladeSpec(item, position);
  return spec?.specification || (spec?.dimensionA && spec.dimensionB ? `${spec.dimensionA}×${spec.dimensionB} ${spec.dimensionUnit || 'mm'}` : '未填写');
}
const emptySupply = (): Supply => ({ supplierName: '', supplierSku: '', productUrl: '', remark: '' });
const pairPattern = /^\s*(\d+(?:\.\d{1,3})?)\s*[×xX*＊]\s*(\d+(?:\.\d{1,3})?)\s*(mm|cm)?\s*$/;
function initialForm(item?: TerminalToolingBladeDTO): TerminalBladeForm {
  return {
    id: item?.id, lockVersion: item?.lockVersion, model: item?.model || '', manufacturer: item?.manufacturer || '',
    remark: item?.remark || '', isActive: item?.isActive ?? true, isDraft: item?.isDraft ?? true,
    positionSpecs: BLADE_POSITIONS.map(position => {
      const spec = bladeSpec(item, position);
      return { position, specification: spec?.specification || '', dimensionA: spec?.dimensionA || '', dimensionB: spec?.dimensionB || '',
        dimensionUnit: spec?.dimensionUnit || 'mm', material: spec?.material || '', hardness: spec?.hardness || '',
        remark: spec?.remark || '', needsReview: spec?.needsReview ?? false,
        supplierLinks: spec?.supplierLinks.map(link => ({ supplierName: link.supplierName, supplierSku: link.supplierSku || '', productUrl: link.productUrl || '', remark: link.remark || '' })) || [] };
    }),
  };
}

export function TerminalBladeEditor({ item, readOnly, saving, error, onClose, onSave }: {
  item?: TerminalToolingBladeDTO; readOnly: boolean; saving: boolean; error: string;
  onClose: () => void; onSave: (form: TerminalBladeForm) => Promise<void>;
}) {
  const [form, setForm] = useState(() => initialForm(item));
  const [attempted, setAttempted] = useState(false);
  const [extra, setExtra] = useState<SpecForm | null>(null);
  const [extraError, setExtraError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const extraDialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const editable = !readOnly && !saving;
  const completed = form.positionSpecs.filter(spec => spec.specification.trim() && !spec.needsReview).length;
  const extraOpen = extra !== null;
  useEffect(() => { const node = dialog.current; node?.showModal(); title.current?.focus(); return () => node?.close(); }, []);
  useEffect(() => { if (extraOpen) extraDialog.current?.showModal(); else extraDialog.current?.close(); }, [extraOpen]);

  function update(position: TerminalToolingBladePositionDTO, key: keyof SpecForm, value: string) {
    setForm(current => ({ ...current, positionSpecs: current.positionSpecs.map(spec => {
      if (spec.position !== position) return spec;
      const next = { ...spec, [key]: value };
      if (key === 'specification') {
        const match = value.match(pairPattern);
        if (match) { next.dimensionA = match[1]; next.dimensionB = match[2]; if (match[3]) next.dimensionUnit = match[3]; }
      } else if (['dimensionA', 'dimensionB'].includes(key) && (!spec.specification || pairPattern.test(spec.specification)) && next.dimensionA && next.dimensionB) {
        next.specification = `${next.dimensionA}×${next.dimensionB}`;
      }
      return next;
    }) }));
  }
  function jump(position: string) {
    dialog.current?.querySelector(`[data-blade-position="${position}"]`)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  async function save(isDraft: boolean) {
    if (!editable) return;
    setAttempted(true);
    if (!form.model.trim()) { dialog.current?.querySelector<HTMLInputElement>('[name="blade-model"]')?.focus(); return; }
    if (!isDraft && completed !== 4) {
      const missing = form.positionSpecs.find(spec => !spec.specification.trim() || spec.needsReview)!;
      jump(missing.position);
      dialog.current?.querySelector<HTMLInputElement>(`[data-blade-position="${missing.position}"] input`)?.focus();
      return;
    }
    await onSave({ ...form, isDraft });
  }
  function finishExtra() {
    if (!extra) return;
    for (const link of extra.supplierLinks) {
      if ((link.supplierSku || link.productUrl || link.remark) && !link.supplierName.trim()) { setExtraError('请填写对应的供应商名称'); return; }
      if (link.productUrl) {
        try { if (!['http:', 'https:'].includes(new URL(link.productUrl).protocol)) throw new Error(); }
        catch { setExtraError('采购链接请填写完整的 HTTP 或 HTTPS 地址'); return; }
      }
    }
    setForm(current => ({ ...current, positionSpecs: current.positionSpecs.map(spec => spec.position === extra.position ? extra : spec) }));
    setExtra(null);
  }
  function updateSupply(index: number, key: keyof Supply, value: string) {
    setExtraError('');
    setExtra(current => current && ({ ...current, supplierLinks: current.supplierLinks.map((link, i) => i === index ? { ...link, [key]: value } : link) }));
  }
  return <>
    <dialog ref={dialog} className="tooling-blade-dialog" aria-labelledby="blade-editor-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
      <header className="blade-editor-header"><div className="blade-editor-heading"><span className="blade-icon"><Grid2X2 /></span><div><h2 ref={title} tabIndex={-1} id="blade-editor-title">{item ? readOnly ? '刀片型号资料' : '编辑刀片型号' : '新增刀片型号'}</h2><p>一个型号，四个刀位分别维护规格。</p></div></div><button type="button" className="blade-icon-button" disabled={saving} onClick={onClose} aria-label="关闭刀片编辑"><X /></button></header>
      <div className="blade-editor-scroll">
        <section className="blade-model-section"><div className="blade-section-title"><h3><b>01</b>型号信息</h3><span>同一组刀片共用</span></div><div className="blade-model-fields">
          <label><span>刀片型号 <em>*</em></span><input name="blade-model" autoComplete="off" maxLength={120} disabled={!editable} value={form.model} placeholder="输入这组刀片的型号" aria-invalid={attempted && !form.model.trim()} onChange={event => setForm({ ...form, model: event.target.value })} />{attempted && !form.model.trim() && <small className="blade-error">请填写刀片型号</small>}</label>
          <label><span>制造商 / 品牌</span><input maxLength={120} disabled={!editable} value={form.manufacturer} placeholder="填写制造商或品牌，可留空" onChange={event => setForm({ ...form, manufacturer: event.target.value })} /></label>
        </div></section>
        <section><div className="blade-section-title blade-position-title"><div><h3><b>02</b>四刀位规格</h3><p>每个刀位独立填写，尺寸按实际记录。</p></div><span className="blade-count">{completed} / 4 已填写</span></div>
          <nav className="blade-mobile-jump" aria-label="跳转刀位">{BLADE_POSITIONS.map(position => <button key={position} type="button" onClick={() => jump(position)}>{BLADE_LABELS[position]}</button>)}</nav>
          <div className="blade-spec-grid">{form.positionSpecs.map((spec, index) => <article className={`blade-spec-card ${attempted && (!spec.specification.trim() || spec.needsReview) ? 'blade-spec-missing' : ''}`} data-blade-position={spec.position} key={spec.position}>
            <header><div><span className="blade-position-icon" aria-hidden="true">{BLADE_POSITIONS.map((position, i) => <i className={i === index ? 'active' : ''} key={position} />)}</span><h4>{BLADE_LABELS[spec.position]}</h4></div><span className={`blade-spec-status ${spec.specification.trim() && !spec.needsReview ? 'complete' : ''}`}>{spec.needsReview ? '待核对' : spec.specification.trim() ? <><CheckCircle2 />已填写</> : '未填写'}</span></header>
            <label><span>规格 <em>*</em></span><input aria-label={`${BLADE_LABELS[spec.position]}规格`} maxLength={160} disabled={!editable} value={spec.specification} placeholder="例如：2.4×1.5，或填写完整规格" onChange={event => update(spec.position, 'specification', event.target.value)} aria-invalid={attempted && !spec.specification.trim()} /></label>
            <div className="blade-dimensions"><label><span>尺寸 A</span><input aria-label={`${BLADE_LABELS[spec.position]}尺寸A`} inputMode="decimal" disabled={!editable} value={spec.dimensionA} onChange={event => update(spec.position, 'dimensionA', event.target.value)} placeholder="按实际填写" /></label><b>×</b><label><span>尺寸 B</span><input aria-label={`${BLADE_LABELS[spec.position]}尺寸B`} inputMode="decimal" disabled={!editable} value={spec.dimensionB} onChange={event => update(spec.position, 'dimensionB', event.target.value)} placeholder="按实际填写" /></label><label className="blade-unit"><span>单位</span><input aria-label={`${BLADE_LABELS[spec.position]}单位`} maxLength={20} disabled={!editable} value={spec.dimensionUnit} onChange={event => update(spec.position, 'dimensionUnit', event.target.value)} /></label></div>
            {spec.needsReview && <div className="blade-legacy-review"><span>继承自旧共用规格，请核对实际刀片。</span>{editable && <button type="button" onClick={() => setForm(current => ({ ...current, positionSpecs: current.positionSpecs.map(row => row.position === spec.position ? { ...row, needsReview: false } : row) }))}>已核对此刀位</button>}</div>}
            <button type="button" className="blade-extras-button" disabled={saving} onClick={() => { setExtra({ ...spec, supplierLinks: spec.supplierLinks.map(link => ({ ...link })) }); setExtraError(''); }}><span><Settings2 />材质、硬度、采购来源</span><span>{[spec.material, spec.hardness, spec.supplierLinks.some(link => link.supplierName) ? '采购来源' : ''].filter(Boolean).length || ''}<ChevronRight /></span></button>
          </article>)}</div>
        </section>
        <details className="blade-group-remark"><summary>整组备注 <span>按需补充</span></summary><textarea aria-label="整组备注" maxLength={2000} disabled={!editable} value={form.remark} placeholder="记录这组刀片的通用说明" onChange={event => setForm({ ...form, remark: event.target.value })} /></details>
        {error && <div className="blade-error" role="alert">{error}</div>}
      </div>
      <footer className="blade-editor-footer"><span className="blade-footer-progress"><CheckCircle2 />已填写 <strong>{completed}</strong> / 4 个刀位</span><div><button type="button" disabled={saving} onClick={onClose}>取消</button>{!readOnly && <><button type="button" disabled={saving} onClick={() => save(true)}>保存草稿</button><button type="button" className="primary" disabled={saving} onClick={() => save(false)}><Save />{saving ? '正在保存…' : '保存整组刀片'}</button></>}</div></footer>
    </dialog>
    <dialog ref={extraDialog} className="tooling-blade-dialog blade-extra-dialog" aria-labelledby="blade-extra-title" onCancel={event => { event.preventDefault(); setExtra(null); }}>
      {extra && <><header className="blade-editor-header"><div><small className="blade-eyebrow">当前刀位</small><h2 id="blade-extra-title">{BLADE_LABELS[extra.position]} · 补充参数</h2><p>{form.model || '未填写型号'} · {extra.specification || '规格未填写'}</p></div><button type="button" className="blade-icon-button" aria-label="关闭补充参数" onClick={() => setExtra(null)}><X /></button></header>
        <div className="blade-editor-scroll"><div className="blade-model-fields"><label><span>材质</span><input maxLength={120} disabled={!editable} value={extra.material} placeholder="按实际填写" onChange={event => setExtra({ ...extra, material: event.target.value })} /></label><label><span>硬度</span><input maxLength={120} disabled={!editable} value={extra.hardness} placeholder="按实际填写" onChange={event => setExtra({ ...extra, hardness: event.target.value })} /></label></div>
          <div className="blade-section-title blade-supply-title"><h3>采购来源</h3>{editable && <button type="button" disabled={extra.supplierLinks.length >= 20} onClick={() => setExtra({ ...extra, supplierLinks: [...extra.supplierLinks, emptySupply()] })}><Plus />添加来源</button>}</div>
          {!extra.supplierLinks.length && <p className="blade-supply-empty">暂未填写采购来源，可按需添加。</p>}
          {extra.supplierLinks.map((link, i) => <div className="blade-supply-card" key={i}><div><strong>来源 {i + 1}</strong>{editable && <button type="button" aria-label={`移除来源${i + 1}`} onClick={() => setExtra({ ...extra, supplierLinks: extra.supplierLinks.filter((_, j) => i !== j) })}><X /></button>}</div><div className="blade-model-fields"><label><span>供应商名称</span><input maxLength={120} disabled={!editable} value={link.supplierName} onChange={event => updateSupply(i, 'supplierName', event.target.value)} /></label><label><span>供应商货号</span><input maxLength={120} disabled={!editable} value={link.supplierSku} onChange={event => updateSupply(i, 'supplierSku', event.target.value)} /></label></div><label><span>采购链接</span><input maxLength={1000} disabled={!editable} value={link.productUrl} placeholder="https://商品链接" onChange={event => updateSupply(i, 'productUrl', event.target.value)} /></label><label><span>来源备注</span><input maxLength={500} disabled={!editable} value={link.remark} onChange={event => updateSupply(i, 'remark', event.target.value)} /></label></div>)}
          <label className="blade-extra-remark"><span>此刀位备注</span><textarea maxLength={2000} disabled={!editable} value={extra.remark} placeholder="仅记录当前刀位的补充说明" onChange={event => setExtra({ ...extra, remark: event.target.value })} /></label>{extraError && <p className="blade-error" role="alert">{extraError}</p>}
        </div><footer className="blade-editor-footer"><span>只应用于 <strong>{BLADE_LABELS[extra.position]}</strong></span><button type="button" className="primary" onClick={readOnly ? () => setExtra(null) : finishExtra}><Check />完成</button></footer></>}
    </dialog>
  </>;
}
