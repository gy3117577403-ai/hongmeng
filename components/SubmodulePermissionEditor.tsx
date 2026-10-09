'use client';
import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { BUSINESS_ACCESS_MODULES, BUSINESS_SUBMODULES, expandModulePermissions, type ModulePermissions, type ModuleAccessLevel } from '@/lib/module-permissions';
import styles from './SubmodulePermissionEditor.module.css';

export default function SubmodulePermissionEditor({ value, original, disabled, onChange }: { value: ModulePermissions; original: ModulePermissions; disabled: boolean; onChange: (value: ModulePermissions) => void }) {
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(['production']);
  const permissions = expandModulePermissions(value), before = expandModulePermissions(original);
  const changes = BUSINESS_SUBMODULES.filter(item => permissions[item.key] !== before[item.key]);
  const setItems = (keys: string[], level?: ModuleAccessLevel) => {
    const next = { ...permissions };
    for (const item of BUSINESS_SUBMODULES.filter(item => keys.includes(item.key))) {
      if (level) next[item.key] = item.readOnly ? 'READ' : level; else delete next[item.key];
    }
    onChange(next);
  };
  const levelLabel = (level?: ModuleAccessLevel) => level === 'COLLABORATE' ? '协同' : level === 'READ' ? '只读' : '未开通';
  return <div className={styles.editor}>
    <div className={styles.toolbar}><label><Search size={16}/><input aria-label="搜索小模块" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索功能，如计划、配料、工时" /></label><button type="button" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(!selectedOnly)}>{selectedOnly && <Check size={14}/>}只看已开通</button></div>
    <div className={styles.groups}>{BUSINESS_ACCESS_MODULES.map(group => {
      const children = BUSINESS_SUBMODULES.filter(item => item.group === group.key);
      const visible = children.filter(item => (!selectedOnly || permissions[item.key]) && (!query.trim() || `${group.label}${item.label}`.includes(query.trim())));
      if (!visible.length) return null;
      const selected = children.filter(item => permissions[item.key]);
      const open = Boolean(query.trim()) || expanded.includes(group.key);
      return <section className={styles.group} key={group.key}>
        <div className={styles.groupHeader}><button type="button" className={styles.expand} aria-expanded={open} onClick={() => setExpanded(open ? expanded.filter(key => key !== group.key) : [...expanded, group.key])}>{open ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}<strong>{group.label}</strong><span>{selected.length}/{children.length} 项</span></button><select aria-label={`批量设置${group.label}`} disabled={disabled} value="" onChange={event => { setItems(children.map(item => item.key), event.target.value === 'OFF' ? undefined : event.target.value as ModuleAccessLevel); if (!open) setExpanded([...expanded, group.key]); }}><option value="">批量设置</option><option value="OFF">全部关闭</option><option value="READ">全部只读</option>{group.key !== 'reports' && <option value="COLLABORATE">全部协同</option>}</select></div>
        {open && <div className={styles.rows}>{visible.map(item => <div className={`${styles.row} ${permissions[item.key] ? styles.enabled : ''}`} key={item.key}><span className={styles.itemName}><i className={permissions[item.key] === 'COLLABORATE' ? styles.collaborate : permissions[item.key] ? styles.read : ''}/>{item.label}</span><div className={styles.levels} role="group" aria-label={`${item.label}权限`}>{([undefined, 'READ', ...(!item.readOnly ? ['COLLABORATE'] : [])] as (ModuleAccessLevel | undefined)[]).map(level => <button key={level || 'OFF'} type="button" aria-label={`${item.label}设为${levelLabel(level)}`} aria-pressed={permissions[item.key] === level} disabled={disabled} onClick={() => setItems([item.key], level)}>{levelLabel(level)}</button>)}</div></div>)}</div>}
      </section>;
    })}</div>
    {!BUSINESS_SUBMODULES.some(item => (!selectedOnly || permissions[item.key]) && (!query.trim() || item.label.includes(query.trim()) || BUSINESS_ACCESS_MODULES.find(group => group.key === item.group)?.label.includes(query.trim()))) && <div className={styles.empty}>没有符合条件的功能<button type="button" onClick={() => { setQuery(''); setSelectedOnly(false); }}>清除筛选</button></div>}
    {!!changes.length && !disabled && <details className={styles.changes}><summary>本次调整 {changes.length} 项</summary>{changes.map(item => <div key={item.key}><strong>{item.label}</strong><span>{levelLabel(before[item.key])} → <b>{levelLabel(permissions[item.key])}</b></span></div>)}</details>}
  </div>;
}
