'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Clock3, Layers3, MapPin, Play, Plus, Search, Wrench } from 'lucide-react';
import type { ToolingJobDTO, ToolingPosition } from '@/lib/tooling-worklog-domain';
import { ASSIST_CATEGORIES, TOOLING_POSITIONS, TOOLING_POSITION_NAMES, boxName, durationText } from '@/lib/tooling-worklog-domain';
import { ToolingDialog, type Catalog, type Submit, asLocal, asShanghai, jobTitle } from './ToolingShared';

type Choice = { position: ToolingPosition; bladeId: string; stockId: string; reuse?: boolean };
export function NewToolingWork({ catalog, employeeId, assist = false, readOnly = false, submit, busy, onClose, onStarted }: { catalog: Catalog; employeeId: string | null; assist?: boolean; readOnly?: boolean; submit: Submit; busy: boolean; onClose: () => void; onStarted: (id: string) => void }) {
  const [spec, setSpec] = useState(''), [terminalId, setTerminalId] = useState(''), [manufacturer, setManufacturer] = useState('');
  const [context, setContext] = useState({ wireRange: '', equipment: '', mold: '' }), [setupId, setSetupId] = useState('');
  const [choices, setChoices] = useState<Choice[]>([]), [category, setCategory] = useState(ASSIST_CATEGORIES[0]), [description, setDescription] = useState('');
  const [backfill, setBackfill] = useState(false), [start, setStart] = useState(asLocal(new Date())), [end, setEnd] = useState(asLocal(new Date())), [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [references,setReferences]=useState<ToolingJobDTO[]>([]),[referenceId,setReferenceId]=useState('');
  useEffect(()=>{let cancelled=false;setReferences([]);setReferenceId('');if(terminalId)void fetch('/api/terminal-tooling/worklog?terminalId='+encodeURIComponent(terminalId)).then(r=>r.json()).then(body=>{if(cancelled||!body.ok)return;setReferences(body.references);const latest=body.references[0] as ToolingJobDTO|undefined;if(latest){setReferenceId('history:'+latest.id);setContext({wireRange:latest.contextSnapshot.wireRange||'',equipment:latest.contextSnapshot.equipment||'',mold:latest.contextSnapshot.mold||''});setChoices(latest.usages.filter(u=>u.isCurrent).map(u=>chooseBlade(u.position,u.bladeId)));}else{const published=catalog.setups.find(s=>s.terminalId===terminalId&&s.status==='PUBLISHED');if(published){recipe(published.id);setReferenceId(published.id);}}}).catch(()=>{if(!cancelled)setError('历史组合暂未加载，可手动选择刀片');});return()=>{cancelled=true;};/* chosen terminal is the reference boundary */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[terminalId]);
  function selectReference(id:string){setReferenceId(id);if(id.startsWith('history:')){const row=references.find(r=>r.id===id.slice(8));if(!row)return;setSetupId('');setContext({wireRange:row.contextSnapshot.wireRange||'',equipment:row.contextSnapshot.equipment||'',mold:row.contextSnapshot.mold||''});setChoices(row.usages.filter(u=>u.isCurrent).map(u=>chooseBlade(u.position,u.bladeId)));}else recipe(id);}
  const terminals = catalog.terminals.filter(t => t.isActive && (!spec || [t.specification,t.manufacturer,...t.aliases].some(v => v?.toLowerCase().includes(spec.toLowerCase())))).slice(0, 8);
  const recipes = catalog.setups.filter(s => s.terminalId === terminalId && s.status === 'PUBLISHED');
  function chooseBlade(position: ToolingPosition, bladeId: string, preferredKit?: string | null) {
    const blade = catalog.blades.find(b => b.id === bladeId);
    const available = blade?.units.filter(u => u.position === position && u.state === 'AVAILABLE') || [];
    const stock = available.find(u => preferredKit && u.kitId === preferredKit) || available[0];
    return { position, bladeId, stockId: stock?.id || '' };
  }
  function wholeSet(bladeId: string) {
    const blade = catalog.blades.find(b => b.id === bladeId);
    const kit = blade?.units.find(u => u.kitId && TOOLING_POSITIONS.every(p => blade.units.some(v => v.kitId === u.kitId && v.position === p && v.state === 'AVAILABLE')))?.kitId;
    setChoices(bladeId ? TOOLING_POSITIONS.filter(p => blade?.compatiblePositions.includes(p)).map(p => chooseBlade(p, bladeId, kit)) : []);
  }
  function selectTerminal(id: string) {
    const terminal = catalog.terminals.find(t => t.id === id); if (!terminal) return;
    setTerminalId(id); setSpec(terminal.specification); setManufacturer(terminal.manufacturer || ''); setSetupId(''); setChoices([]);
    setContext(c => ({...c,wireRange:terminal.wireRange || ''}));
  }
  function recipe(id: string) {
    const setup = catalog.setups.find(s => s.id === id); setSetupId(id); if (!setup) return;
    setContext({wireRange:setup.wireRange || '',equipment:setup.equipment || '',mold:setup.mold || ''});
    setChoices(setup.positions.map(p => chooseBlade(p.position, p.bladeId)));
  }
  async function save() {
    setError('');
    if (!employeeId) { setError('当前账号还没有绑定员工，请联系人事关联员工档案'); return; }
    if (!assist && !spec.trim()) { setError('请填写端子型号'); return; }
    if (assist && !description.trim()) { setError('请填写协助内容'); return; }
    if (backfill && (!start || !end || end <= start || !reason.trim())) { setError('请检查起止时间并填写补报原因'); return; }
    const res = await submit('worklog', { action: backfill ? 'BACKFILL' : 'START', kind: assist ? 'ASSIST' : 'TUNING', terminalId, specification:spec, manufacturer, setupId, ...context, choices: choices.filter(c=>c.bladeId), category, description, ...(backfill ? {startedAt:asShanghai(start), endedAt:asShanghai(end),reason} : {}) });
    if (res?.jobId) onStarted(String(res.jobId));
  }
  return <ToolingDialog title={assist ? '协助报工' : readOnly ? '查端子与刀片' : '开始调模'} subtitle={assist ? '记录调模以外的实际工作' : '选择端子与刀片组合'} onClose={onClose} busy={busy} wide footer={<><button onClick={onClose} disabled={busy}>取消</button>{!readOnly && <button className="tl-primary" disabled={busy || !employeeId} onClick={()=>void save()}><Play size={18}/>{busy ? '正在保存…' : backfill ? '提交协助工时' : '开始计时'}</button>}</>}>
    {error && <div role="alert" className="tl-error">{error}</div>}
    {!readOnly && !employeeId && <div className="tl-error">当前账号未绑定员工，暂不能计时。请联系人事关联员工档案。</div>}
    {assist ? <div className="tl-form"><div className="tl-segment"><button className={!backfill?'active':''} onClick={()=>setBackfill(false)}>实时计时</button><button className={backfill?'active':''} onClick={()=>setBackfill(true)}>补报时段</button></div><label>协助类型<select value={category} onChange={e=>setCategory(e.target.value)}>{ASSIST_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><label>工作内容<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="例如：协助组装、整理刀片" maxLength={500}/></label>{backfill && <><div className="tl-grid2"><label>开始时间<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束时间<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></label></div><label>补报原因<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label></>}</div> : <>
      <section className="tl-form-section"><h3><span>01</span> 端子型号</h3><label className="tl-search"><Search size={18}/><input autoComplete="off" placeholder="输入部分型号，找不到可直接新增" value={spec} onChange={e=>{setSpec(e.target.value);setTerminalId('');setChoices([]);setSetupId('');}}/></label>
        {!terminalId && <div className="tl-suggestions">{terminals.map(t=><button key={t.id} onClick={()=>selectTerminal(t.id)}><div><b>{t.specification}</b><small>{t.manufacturer || '制造商未填写'}</small></div><ArrowRight size={16}/></button>)}{spec.trim() && !terminals.some(t=>t.specification === spec) && <div className="tl-inline-note"><Plus size={16}/>开始计时后自动建档：{spec}</div>}</div>}
        <div className="tl-grid2"><label>制造商 / 品牌<input value={manufacturer} disabled={!!terminalId} onChange={e=>setManufacturer(e.target.value)} placeholder="可稍后完善"/></label><label>参考方案<select value={referenceId} onChange={e=>selectReference(e.target.value)}><option value="">{recipes.length ? '选择已发布方案' : '本次记录新组合'}</option>{references.map((r,i)=><option key={r.id} value={'history:'+r.id}>{i===0?'最近实际组合':'历史组合'} · {r.contextSnapshot.wireRange||'线径未填'} · {r.contextSnapshot.equipment||'设备未填'}</option>)}{recipes.map(s=><option value={s.id} key={s.id}>{s.name || '方案'} · V{s.version} · {s.wireRange || '线径未填'} · {s.equipment || '设备未填'}</option>)}</select></label></div>
      </section>
      <section className="tl-form-section"><h3><span>02</span> 刀片组合</h3><label>整套型号<select aria-label="选择整套型号" value={choices.length === 4 && new Set(choices.map(c=>c.bladeId)).size===1?choices[0].bladeId:''} onChange={e=>wholeSet(e.target.value)}><option value="">选择整套，再按需更换单个刀位</option>{catalog.blades.filter(b=>b.isActive).map(b=><option key={b.id} value={b.id}>{b.model} · {b.stock.registered ? '可用整套 '+b.stock.completeKits : '待盘点'}</option>)}</select></label>
        <div className="tl-blade-grid">{TOOLING_POSITIONS.map(position=>{
          const choice = choices.find(c=>c.position===position); const blade = catalog.blades.find(b=>b.id===choice?.bladeId);
          const units = blade?.units.filter(u=>u.position===position && (u.state==='AVAILABLE' || (u.state==='IN_USE' && u.inUseJob?.employeeId===employeeId && !['RUNNING','PAUSED'].includes(u.inUseJob.status)))) || [];
          return <div className="tl-blade-position" key={position}><h4><Wrench size={15}/>{TOOLING_POSITION_NAMES[position]}</h4><select aria-label={TOOLING_POSITION_NAMES[position]+'型号'} value={choice?.bladeId||''} onChange={e=>setChoices(c=>[...c.filter(v=>v.position!==position),chooseBlade(position,e.target.value)])}><option value="">暂不选刀片</option>{catalog.blades.filter(b=>b.isActive && b.compatiblePositions.includes(position)).map(b=><option key={b.id} value={b.id}>{b.model}</option>)}</select>
            {blade && <><small>{blade.positionSpecs.find(s=>s.position===position)?.specification || '规格待完善'}</small>{blade.stock.registered ? <select aria-label={TOOLING_POSITION_NAMES[position]+'存放位置'} value={choice?.stockId||''} onChange={e=>setChoices(c=>c.map(v=>v.position===position?{...v,stockId:e.target.value,reuse:units.find(u=>u.id===e.target.value)?.state==='IN_USE'}:v))}><option value="">{units.length?'选择实物位置':'暂无可用实物'}</option>{units.map(u=><option key={u.id} value={u.id}>{u.state==='IN_USE' ? '继续使用设备上的刀片' : boxName(u.currentBox)} · {u.kit?.code||'散刀 '+u.id.slice(-4)}</option>)}</select> : <span className="tl-tag amber"><MapPin size={13}/>数量与位置待盘点</span>}</>}
          </div>;
        })}</div>
      </section>
      <section className="tl-form-section"><h3><span>03</span> 本次条件</h3><div className="tl-grid3">{(['wireRange','equipment','mold'] as const).map((key,i)=><label key={key}>{['适用线径','设备','模具'][i]}<input value={context[key]} onChange={e=>setContext(c=>({...c,[key]:e.target.value}))} placeholder="可选" maxLength={100}/></label>)}</div></section>
    </>}
  </ToolingDialog>;
}

export function FinishToolingWork({job,submit,busy,onClose,onDone}:{job:ToolingJobDTO;submit:Submit;busy:boolean;onClose:()=>void;onDone:()=>void}) {
  const usages=job.usages.filter(u=>u.isCurrent).sort((a,b)=>TOOLING_POSITIONS.indexOf(a.position)-TOOLING_POSITIONS.indexOf(b.position)), [result,setResult]=useState('COMPLETED'),[note,setNote]=useState('');
  const [dispositions,setDispositions]=useState(usages.map(u=>({usageId:u.id,disposition:'HOME',box:u.snapshot.homeBox||1})));
  async function finish(){const res=await submit('worklog',{action:'FINISH',jobId:job.id,version:job.version,result,resultNote:note,dispositions});if(res)onDone();}
  return <ToolingDialog title={job.kind==='TUNING'?'完成调模':'完成协助'} subtitle={jobTitle(job)} onClose={onClose} busy={busy} footer={<><button disabled={busy} onClick={onClose}>继续作业</button><button className="tl-primary" disabled={busy || (result==='INCOMPLETE'&&!note.trim())} onClick={()=>void finish()}><Check size={18}/>{busy?'保存中…':'结束并记录工时'}</button></>}>
    <div className="tl-segment"><button className={result==='COMPLETED'?'active':''} onClick={()=>setResult('COMPLETED')}>已完成</button><button className={result==='INCOMPLETE'?'active':''} onClick={()=>setResult('INCOMPLETE')}>需继续处理</button></div>
    <label>结果备注{result==='INCOMPLETE'?' *':''}<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder={result==='INCOMPLETE'?'记录问题与下一步':'记录调整参数或注意事项'} maxLength={2000}/></label>
    {!!usages.length && <section className="tl-form-section"><h3><Layers3 size={18}/> 刀片去向</h3><button className="tl-text" onClick={()=>setDispositions(d=>d.map(v=>({...v,disposition:'HOME'})))}>全部原盒归位</button>{usages.map(u=>{const d=dispositions.find(v=>v.usageId===u.id)!;return <div key={u.id} className="tl-return-row"><div><b>{TOOLING_POSITION_NAMES[u.position]}</b><small>{u.snapshot.model} · {u.snapshot.homeBox?boxName(u.snapshot.homeBox):'库存未登记'}</small></div><select value={d.disposition} aria-label={TOOLING_POSITION_NAMES[u.position]+'去向'} onChange={e=>setDispositions(ds=>ds.map(v=>v.usageId===u.id?{...v,disposition:e.target.value}:v))}><option value="HOME">原盒归位</option><option value="BOX">放入其他盒</option><option value="DEVICE">仍在设备上</option><option value="MAINTENANCE">待处理 / 维修</option></select>{d.disposition==='BOX' && <input type="number" aria-label="归还盒号" min={1} max={100} value={d.box} onChange={e=>setDispositions(ds=>ds.map(v=>v.usageId===u.id?{...v,box:Number(e.target.value)}:v))}/>}</div>})}</section>}
  </ToolingDialog>;
}

export function CorrectToolingTime({job,submit,busy,onClose,onDone}:{job:ToolingJobDTO;submit:Submit;busy:boolean;onClose:()=>void;onDone:()=>void}){
  const [intervals,setIntervals]=useState(job.segments.filter(s=>s.kind==='WORK'&&s.endedAt).map(s=>({startedAt:asLocal(s.startedAt),endedAt:asLocal(s.endedAt!)}))),[reason,setReason]=useState('');
  const ms=useMemo(()=>intervals.reduce((n,s)=>n+Math.max(0,+new Date(s.endedAt)-+new Date(s.startedAt)),0),[intervals]);
  async function save(){if(intervals.some(s=>!s.startedAt||!s.endedAt))return;const res=await submit('worklog',{action:'CORRECT',jobId:job.id,version:job.version,reason,segments:intervals.map(s=>({startedAt:asShanghai(s.startedAt),endedAt:asShanghai(s.endedAt)}))});if(res)onDone();}
  return <ToolingDialog title="修正有效工时" subtitle={jobTitle(job)} onClose={onClose} busy={busy} footer={<><span><Clock3 size={15}/> {durationText(ms)}</span><button className="tl-primary" disabled={busy||!reason.trim()} onClick={()=>void save()}>保存修正</button></>}>
    {intervals.map((s,i)=><div className="tl-grid2" key={i}><label>开始时间<input type="datetime-local" value={s.startedAt} onChange={e=>setIntervals(v=>v.map((x,n)=>n===i?{...x,startedAt:e.target.value}:x))}/></label><label>结束时间<input type="datetime-local" value={s.endedAt} onChange={e=>setIntervals(v=>v.map((x,n)=>n===i?{...x,endedAt:e.target.value}:x))}/></label><button className="tl-text" disabled={intervals.length===1} onClick={()=>setIntervals(v=>v.filter((_,n)=>n!==i))}>移除此时段</button></div>)}
    <button onClick={()=>setIntervals(v=>[...v,{startedAt:asLocal(job.startedAt),endedAt:asLocal(job.endedAt!)}])}><Plus size={16}/>增加工作时段</button><label>修正原因<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500}/></label><small>原始时段保留在操作记录中，工时台账同步更正。</small>
  </ToolingDialog>;
}
