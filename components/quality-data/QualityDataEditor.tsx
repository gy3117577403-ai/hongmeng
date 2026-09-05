'use client';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, Check, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import {
  CONTEXT_FIELDS, QUALITY_LABELS, RESULT_LABELS, beijingInput, emptyQualityForm, qualityForm, qualityResult,
  type QualityDataType, type QualityFormData, type QualityMeasurement, type QualityOrder, type QualityRecord,
} from '@/lib/quality-data';
import type { CurrentUserDTO } from '@/types';
import { qualityJson, qualityRequest } from './client';
import type { QualityTeamOption } from '@/lib/quality-reference';
import QualityReferencePeek from './QualityReferencePeek';
type Props = { user: CurrentUserDTO; order: QualityOrder; type: QualityDataType; record?: QualityRecord; sourceQrCode?: string; supersedesId?: string; onSaved: (record: QualityRecord, submitted: boolean) => void; onClose: () => void };
export default function QualityDataEditor({ user, order, type, record, sourceQrCode, supersedesId, onSaved, onClose }: Props) {
  const [current, setCurrent] = useState(record);
  const [form, setForm] = useState<QualityFormData>(() => {
    if (record) return record.data;
    const value = emptyQualityForm(type, user.displayName || user.username);
    if (order.steps.length === 1) value.context.processName = order.steps[0].name;
    return value;
  });
  const [teams,setTeams] = useState<QualityTeamOption[]>([]),[teamQuery,setTeamQuery] = useState(''),[referenceOpen,setReferenceOpen] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    qualityRequest<{teams:QualityTeamOption[]}>('options').then(options=>{
      if(!active)return;setTeams(options.teams);
      if(!record){const matches=options.teams.filter(t=>user.dailyPlanningTeamIds.includes(t.id)||Boolean(user.employee?.team&&(t.name===user.employee.team||t.legacyTeamName===user.employee.team)));
        if(matches.length===1)setForm(previous=>previous.teamId||previous.context.team?previous:{...previous,teamId:matches[0].id,context:{...previous.context,team:matches[0].name}});
      }
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[record,user]);
  const [title, setTitle] = useState(record?.title || QUALITY_LABELS[type] + '记录');
  const [inspectedAt, setInspectedAt] = useState(beijingInput(record?.inspectedAt));
  const [reason, setReason] = useState(''), [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const key = useRef('');
  const input = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const isSubmitted = current?.status === 'SUBMITTED';
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty || busy || files.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, busy, files.length]);
  function change(next: QualityFormData) { setForm(next); setDirty(true); setNotice(''); }
  function rowChange(index: number, field: keyof QualityMeasurement, value: string) {
    change({ ...form, rows: form.rows.map((row, i) => i === index ? { ...row, [field]: value } : row) });
  }
  function switchMode(mode: QualityFormData['mode']) {
    if (mode === form.mode) return;
    if (mode === 'FILE' && form.rows.some(row => row.value || row.standard || row.lower || row.upper || row.note)
      && !window.confirm('切换为文件归档会清空当前检查明细，是否继续？')) return;
    change({ ...form, mode, rows: mode === 'FILE' ? [] : emptyQualityForm(type).rows });
  }
  function close() {
    if (saving.current) return;
    if ((dirty || files.length) && !window.confirm('还有未保存内容，确认离开此表单？')) return;
    onClose();
  }
  async function save(submit: boolean) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true); setError(''); setNotice('');
    let latest = current;
    try {
      const normalized = qualityForm(form);
      if (submit) normalized.rows = normalized.rows.filter(row=>row.value);
      if (isSubmitted && !reason.trim()) throw new Error('修改已提交记录，请填写修订原因');
      if (!key.current) key.current = crypto.randomUUID();
      const metadata = { title: title.trim() || QUALITY_LABELS[type] + '记录', inspectedAt, data: normalized, reason };
      latest = latest
        ? await qualityRequest<QualityRecord>('records/' + latest.id, qualityJson('PATCH', { ...metadata, version: latest.version, action: 'SAVE' }))
        : await qualityRequest<QualityRecord>('records', qualityJson('POST', { ...metadata, workOrderId: order.id, type, sourceQrCode, supersedesId, idempotencyKey: key.current }));
      setCurrent(latest); setDirty(false);
      for (const file of files) {
        const upload = new FormData();
        upload.set('file', file); upload.set('version', String(latest.version)); upload.set('reason', reason);
        latest = await qualityRequest<QualityRecord>('records/' + latest.id + '/attachments', { method: 'POST', body: upload });
        setCurrent(latest); setFiles(pending => pending.filter(item => item !== file));
      }
      if (submit && latest.status !== 'SUBMITTED') {
        latest = await qualityRequest<QualityRecord>('records/' + latest.id, qualityJson('PATCH', { ...metadata, version: latest.version, action: 'SUBMIT' }));
        setCurrent(latest);
      }
      setNotice(latest.status === 'SUBMITTED' ? '已提交并同步到质量数据' : '草稿已保存，稍后可继续填写');
      setForm(latest.data);
      onSaved(latest, submit || latest.status === 'SUBMITTED');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally { setBusy(false); saving.current = false; }
  }
  async function removeFile(id: string) {
    if (!current || busy) return;
    const note = window.prompt('请输入移除附件的原因：');
    if (!note?.trim()) return;
    setBusy(true); setError('');
    try {
      const updated = await qualityRequest<QualityRecord>('attachments/' + id, qualityJson('DELETE', { version: current.version, reason: note }));
      setCurrent(updated); onSaved(updated, false);
    } catch (e) { setError(e instanceof Error ? e.message : '移除失败'); }
    finally { setBusy(false); }
  }
  let preview = 'PENDING';
  try { preview = qualityResult(qualityForm(form)); } catch { /* Validation is shown when saved. */ }
  function queueFiles(chosen:File[]) {
    if (chosen.some(file=>file.size>20*1024*1024)) { setError('单个文件不能超过 20 MB'); return; }
    if (chosen.length+files.length+(current?.attachments.filter(f=>!f.deletedAt).length||0)>30) { setError('每份记录最多 30 个有效附件'); return; }
    setFiles(previous=>[...previous,...chosen]); setDirty(true);
    if(form.mode==='FILE'&&!current&&title===QUALITY_LABELS[type]+'记录'&&chosen[0])setTitle(chosen[0].name.replace(/\.[^.]+$/,'').slice(0,160));
  }
  function addSample() {
    const previous=form.rows[form.rows.length-1]||emptyQualityForm(type).rows[0];
    change({...form,rows:[...form.rows,{...previous,sample:String(form.rows.length+1),value:'',note:'',result:'PENDING'}]});
  }
  return <section className="qd-editor qd-editor-compact" aria-label={QUALITY_LABELS[type]+'填报'}>
    <header className="qd-editor-head"><div><h2>{QUALITY_LABELS[type]}<small>{current?.code||'新增记录'}</small></h2></div><button type="button" className="qd-icon" onClick={close} disabled={busy} aria-label="关闭填报"><X size={22}/></button></header>
    <div className="qd-order-strip"><strong>{order.specification||order.productName}</strong><span>{order.businessCode||order.code}{order.batchNo?' · 第 '+order.batchNo+' 批':''}</span><small>{order.customerName||'客户未填写'} · {order.quantity??'—'} 件</small></div>
    <div className="qd-editor-body">
      {error&&<div role="alert" className="qd-alert error">{error}{current&&<button type="button" onClick={async()=>{
        if(!window.confirm('重新载入会替换未保存修改，继续？'))return;
        try{const fresh=await qualityRequest<QualityRecord>('records/'+current.id);setCurrent(fresh);setForm(fresh.data);setTitle(fresh.title);setInspectedAt(beijingInput(fresh.inspectedAt));setDirty(false);setError('');}catch(e){setError(e instanceof Error?e.message:'读取失败');}
      }}>载入最新版本</button>}</div>}
      {notice&&<div role="status" className="qd-alert success"><Check size={16}/>{notice}</div>}
      <fieldset className="qd-editor-fields" disabled={busy}>
      <div className="qd-entry-toolbar"><div className="qd-mode" role="group" aria-label="填报方式">{(['FORM','FILE'] as const).map(mode=><button type="button" key={mode} className={form.mode===mode?'active':''} onClick={()=>switchMode(mode)}>{mode==='FORM'?'在线填写':'文件归档'}</button>)}</div><button type="button" className="qd-reference-link" onClick={()=>setReferenceOpen(true)}><BookOpen size={16}/>查看参考数据</button></div>
      <div className="qd-entry-context"><label>检验时间<input aria-label="检验时间" type="datetime-local" value={inspectedAt} onChange={e=>{setInspectedAt(e.target.value);setDirty(true);}}/></label><label>班组<select aria-label="班组" value={form.teamId||''} onChange={e=>{const team=teams.find(t=>t.id===e.target.value);change({...form,teamId:team?.id||'',context:{...form.context,team:team?.name||''}});}}><option value="">{!form.teamId&&form.context.team?'历史班组：'+form.context.team:'选择班组（选填）'}</option>{form.teamId&&!teams.some(t=>t.id===form.teamId)&&<option value={form.teamId}>{form.context.team} · 历史班组</option>}{teams.filter(t=>!teamQuery||t.name.includes(teamQuery)||t.id===form.teamId).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="qd-team-search">查找班组<input aria-label="查找班组" placeholder="输入班组名称" value={teamQuery} onChange={e=>setTeamQuery(e.target.value)}/></label></div>
      <details className="qd-more-fields qd-context-disclosure"><summary>检验信息<span>{form.context.inspectedBy}{form.context.processName?' · '+form.context.processName:''} · 可修改</span></summary><div className="qd-context-grid"><label>记录标题<input aria-label="记录标题" value={title} onChange={e=>{setTitle(e.target.value);setDirty(true);}}/></label>{CONTEXT_FIELDS.filter(([name])=>['processName','inspectedBy'].includes(name)).map(([name,label])=><label key={name}>{label}<input aria-label={label} list={name==='processName'?'qd-process-options':undefined} value={form.context[name]} onChange={e=>change({...form,context:{...form.context,[name]:e.target.value}})}/></label>)}</div></details>
      <datalist id="qd-process-options">{order.steps.map(step=><option key={step.id} value={step.name}/>)}</datalist>
      {form.mode==='FORM'&&<><div className="qd-section-title"><b>本次检验 <small>{form.rows.filter(r=>r.value).length} 项已填写</small></b><span className={'qd-badge '+preview.toLowerCase()}>{RESULT_LABELS[preview as keyof typeof RESULT_LABELS]}</span></div><div className="qd-measurements">{form.rows.map((row,index)=><article className="qd-measure-row" key={index}><div className="qd-quick-measure"><label>样本<input aria-label={'样本编号 '+(index+1)} value={row.sample} onChange={e=>rowChange(index,'sample',e.target.value)}/></label><label>检验项目<input aria-label={'检验项目 '+(index+1)} value={row.item} onChange={e=>rowChange(index,'item',e.target.value)}/></label><label className="qd-value-input">实测 / 检查结果<input aria-label={'实测 / 检查结果 '+(index+1)} placeholder="填写本次结果" value={row.value} onChange={e=>rowChange(index,'value',e.target.value)}/></label><label>单位<input aria-label={'单位 '+(index+1)} value={row.unit} onChange={e=>rowChange(index,'unit',e.target.value)}/></label><button type="button" className="qd-icon" aria-label={'删除检查项 '+(index+1)} onClick={()=>change({...form,rows:form.rows.filter((_,i)=>i!==index)})}><Trash2 size={16}/></button></div><details className="qd-measure-standard"><summary>标准与判定<span>{row.lower||row.upper?((row.lower||'—')+'～'+(row.upper||'—')+' '+row.unit):row.standard||'按需补充'}</span></summary><div className="qd-measure-grid">{([['position','位置 / 线号'],['standard','标准 / 依据'],['lower','标准下限'],['upper','标准上限']] as const).map(([field,label])=><label key={field}>{label}<input aria-label={label+' '+(index+1)} value={row[field]} onChange={e=>rowChange(index,field,e.target.value)}/></label>)}<label>人工判定<select aria-label={'人工判定 '+(index+1)} value={row.result} disabled={Boolean(row.lower||row.upper)} onChange={e=>rowChange(index,'result',e.target.value)}><option value="PENDING">待判定</option><option value="PASS">合格</option><option value="FAIL">不合格</option></select></label><label className="qd-row-note">项目备注<input aria-label={'项目备注 '+(index+1)} value={row.note} onChange={e=>rowChange(index,'note',e.target.value)}/></label></div></details></article>)}</div><button type="button" className="qd-add-row" disabled={form.rows.length>=120} onClick={addSample}><Plus size={17}/>添加检查项 / 下一样本</button><p className="qd-help">填写本次实际检查的项目即可；未填写标准时保留“待判定”。</p></>}
      <div className="qd-entry-extras"><section><label className="qd-summary-label">备注 / 异常说明（选填）<textarea aria-label="内容摘要" rows={3} maxLength={4000} value={form.summary} placeholder="需要说明时再填写" onChange={e=>change({...form,summary:e.target.value})}/></label><details className="qd-more-fields"><summary>数量、端子、线材和追溯信息</summary><div className="qd-context-grid">{CONTEXT_FIELDS.filter(([name])=>!['processName','team','inspectedBy'].includes(name)).map(([name,label])=><label key={name}>{label}<input aria-label={label} value={form.context[name]} onChange={e=>change({...form,context:{...form.context,[name]:e.target.value}})}/></label>)}</div></details></section><section><div className="qd-section-title"><b>照片与附件</b><span>20 MB / 个</span></div><input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-label="拍摄质量照片" onChange={e=>{queueFiles(Array.from(e.target.files||[]));e.target.value='';}}/><input ref={input} type="file" aria-label="添加质量附件" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls" multiple hidden onChange={e=>{queueFiles(Array.from(e.target.files||[]));e.target.value='';}}/><div className="qd-upload-actions"><button className="qd-upload" type="button" onClick={()=>input.current?.click()}><Camera size={22}/><b>选择照片或文件</b><span>PDF / 照片 / Excel</span></button><button type="button" className="qd-camera-button" onClick={()=>camera.current?.click()}><Camera size={20}/>拍照</button></div><div className="qd-file-list">{current?.attachments.filter(f=>!f.deletedAt).map(file=><div key={file.id}><a href={'/api/quality-data/attachments/'+file.id+'/content?download=1'}>{file.originalName}</a><small>已同步</small><button type="button" aria-label={'移除 '+file.originalName} onClick={()=>void removeFile(file.id)}><X size={16}/></button></div>)}{files.map((file,index)=><div key={index}><span>{file.name}</span><small>待上传</small><button type="button" aria-label={'取消上传 '+file.name} onClick={()=>setFiles(items=>items.filter((_,i)=>i!==index))}><X size={16}/></button></div>)}</div></section></div>
      {isSubmitted&&<label className="qd-summary-label">修订原因<textarea aria-label="修订原因" value={reason} onChange={e=>{setReason(e.target.value);setDirty(true);}} placeholder="说明修改内容及原因" rows={2}/></label>}
      </fieldset>
    </div><footer className="qd-editor-footer"><span className="qd-save-state" role="status">{busy?'正在保存…':dirty||files.length?'有未保存内容':current?'已同步':'填写后保存'}</span><button type="button" onClick={close} disabled={busy}>取消</button>{!isSubmitted&&<button type="button" onClick={()=>void save(false)} disabled={busy}><Save size={16}/>保存草稿</button>}<button type="button" className="qd-primary" onClick={()=>void save(true)} disabled={busy}>{busy?<Loader2 size={17} className="qd-spin"/>:<Check size={17}/>} {busy?'保存中…':isSubmitted?'保存修订':'提交记录'}</button></footer>
    {referenceOpen&&<QualityReferencePeek onClose={()=>setReferenceOpen(false)}/>}
  </section>;
}
