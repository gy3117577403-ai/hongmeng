'use client';
import { useRef, useState } from 'react';
import { ArrowRightLeft, Check, Loader2, X } from 'lucide-react';
import type { UserDTO } from '@/types';
import { useModalLayer } from './useModalLayer';
import styles from './BusinessApprovalHandoffDialog.module.css';
type Preview = { fingerprint: string; transferCount: number; mutedCount: number; selfApprovalFallbackCount: number; submissionCount: number; from: {name: string; username: string}; to: {name: string; username: string; employeeNo: string}; changes: {key: string;label: string;before:string;after:string}[]; blockers:{id:string;title:string;message:string}[]; items:{id:string;title:string;sourceType:string}[] };
export default function BusinessApprovalHandoffDialog({accounts, sourceId, onClose, onSaved}:{accounts:UserDTO[];sourceId:string;onClose:()=>void;onSaved:()=>void}) {
 const sources=accounts.filter(a=>a.laborRole==='ADMIN'||a.accessGrants?.some(g=>g.isActive&&g.profileKey==='ADMIN_GLOBAL'));
 const targets=accounts.filter(a=>a.isActive&&a.employee?.isActive&&a.laborRole!=='ADMIN'&&!sources.some(s=>s.id===a.id));
 const named=targets.filter(a=>a.employee?.name==='张豪');
 const [from,setFrom]=useState(sources.some(a=>a.id===sourceId)?sourceId:sources[0]?.id||'');
 const [to,setTo]=useState(named.length===1?named[0].id:'');
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 const ref=useRef<HTMLElement>(null);
 useModalLayer({open:true,layerRef:ref,onClose:()=>{if(!busy)onClose();}});
 async function run(action:'preview'|'apply') {setBusy(true);setError('');try{const r=await fetch('/api/admin/business-handoff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,fromUserId:from,toUserId:to,fingerprint:preview?.fingerprint})});const b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'交接失败');if(action==='preview')setPreview(b.preview);else{setDone(true);onSaved();}}catch(e){setError((e as Error).message);if(action==='apply')setPreview(null);}finally{setBusy(false);}}
 return <div className={styles.backdrop}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="handoff-title" className={styles.dialog}>
 <header><span className={styles.icon}><ArrowRightLeft/></span><div><h2 id="handoff-title">审批交接</h2><p>当前待办与后续审批</p></div><button aria-label="关闭审批交接" disabled={busy} onClick={onClose}><X/></button></header>
 <div className={styles.body}>{done?<div className={styles.success}><Check/><h3>交接已生效</h3><p>业务历史与审批签名已保留，接替账号重新登录后使用新权限。</p></div>:<>
 <div className={styles.accounts}><label>交出账号<select aria-label="交出账号" disabled={busy} value={from} onChange={e=>{setFrom(e.target.value);setPreview(null);}}>{sources.map(a=><option key={a.id} value={a.id}>{a.displayName} · {a.username}</option>)}</select></label><ArrowRightLeft/><label>接替员工<select aria-label="接替员工" disabled={busy} value={to} onChange={e=>{setTo(e.target.value);setPreview(null);}}><option value="">选择员工</option>{targets.map(a=><option key={a.id} value={a.id}>{a.employee?.name||a.displayName} · {a.employee?.employeeNo||a.username}</option>)}</select></label></div>
 <div className={styles.rule}><strong>管理员退出以下通知</strong><p>图纸资料变更 · 资料审核 · 采购通知</p><small>原业务处理人继续处理；历史记录保留。</small></div>
 {preview&&<><div className={styles.counts}><div><b>{preview.transferCount}</b><span>审批待办移交</span></div><div><b>{preview.mutedCount}</b><span>退出通知</span></div><div><b>{preview.submissionCount}</b><span>同步报工待办</span></div></div>
 {preview.selfApprovalFallbackCount>0&&<p className={styles.notice}>{preview.selfApprovalFallbackCount} 项由接替人本人发起，保留原审批人处理。</p>}
 <div className={styles.changes}><h3>补充业务权限</h3>{preview.changes.length?preview.changes.map(c=><div key={c.key}><span>{c.label}</span><span>{{OFF:'未开通',READ:'只读',COLLABORATE:'协同'}[c.before]} → 协同</span></div>):<p>现有权限已满足</p>}</div>
 {preview.blockers.length>0&&<div className={styles.error}>{preview.blockers.map(b=><p key={b.id}>{b.title}：{b.message}</p>)}</div>}
 <details><summary>查看待办清单（{preview.items.length}）</summary>{preview.items.map(item=><div className={styles.item} key={item.id}>{item.title}</div>)}</details></>}
 </>}{error&&<div role="alert" className={styles.error}>{error}</div>}</div>
 <footer><button disabled={busy} onClick={onClose}>{done?'完成':'取消'}</button>{!done&&<button className={styles.primary} disabled={busy||!from||!to||Boolean(preview?.blockers.length)} onClick={()=>void run(preview?'apply':'preview')}>{busy?<Loader2 size={16}/>:null}{busy?'处理中…':preview?'确认交接':'预览交接清单'}</button>}</footer>
 </section></div>;
}
