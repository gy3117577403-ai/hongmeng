'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Clock3, Layers3, MapPin, Play, Plus, Search, Trash2, Wrench } from 'lucide-react';
import { ASSIST_CATEGORIES, TOOLING_MODES, TOOLING_POSITIONS, TOOLING_POSITION_NAMES, TOOLING_STATES, boxName, durationText, moldPositionName, type ToolingJobDTO, type ToolingMode, type ToolingPosition } from '@/lib/tooling-worklog-domain';
import { ToolingDialog, type Catalog, type Submit, asLocal, asShanghai } from './ToolingShared';
type Choice = { position: ToolingPosition; bladeId: string; stockId: string; reuse?: boolean };

export function NewToolingWork({ catalog, employeeId, assist = false, readOnly = false, activeWork = false, initialBackfill = false, submit, busy, onClose, onStarted }: { catalog: Catalog; employeeId: string | null; assist?: boolean; readOnly?: boolean; activeWork?: boolean; initialBackfill?: boolean; submit: Submit; busy: boolean; onClose: () => void; onStarted: (id: string) => void }) {
  const [spec,setSpec]=useState(''),[terminalId,setTerminalId]=useState(''),[manufacturer,setManufacturer]=useState('');
  const [mode,setMode]=useState<ToolingMode>('BLADE'),[moldId,setMoldId]=useState(''),[choices,setChoices]=useState<Choice[]>([]);
  const [context,setContext]=useState({wireRange:'',equipment:'',mold:''}),[setupId,setSetupId]=useState('');
  const [backfill,setBackfill]=useState(initialBackfill||activeWork),[completed,setCompleted]=useState(true),[start,setStart]=useState(asLocal(new Date(Date.now()-30*60000))),[end,setEnd]=useState(asLocal(new Date())),[reason,setReason]=useState('');
  const [category,setCategory]=useState(ASSIST_CATEGORIES[0]),[description,setDescription]=useState(''),[error,setError]=useState('');
  const [references,setReferences]=useState<ToolingJobDTO[]>([]),[referenceId,setReferenceId]=useState(''),[loadingRefs,setLoadingRefs]=useState(false);
  const modified=useRef(false);
  const historical=backfill&&completed, mold=catalog.molds.find(m=>m.id===moldId);
  const terminals=catalog.terminals.filter(t=>t.isActive&&(!spec||[t.specification,t.manufacturer,...t.aliases].some(v=>v?.toLowerCase().includes(spec.toLowerCase())))).slice(0,8);
  const recipes=catalog.setups.filter(s=>s.terminalId===terminalId&&s.status==='PUBLISHED');
  const duration=start&&(completed?end:true)?Math.max(0,+(completed?new Date(asShanghai(end)):new Date())-+new Date(asShanghai(start))):0;
  function choiceFor(position:ToolingPosition,bladeId:string,kit?:string|null):Choice {
    const blade=catalog.blades.find(b=>b.id===bladeId), units=blade?.units.filter(u=>u.position===position&&u.state==='AVAILABLE')||[];
    return {position,bladeId,stockId:(units.find(u=>kit&&u.kitId===kit)||units[0])?.id||''};
  }
  function applyHistory(row:ToolingJobDTO){
    setReferenceId('history:'+row.id);setSetupId('');setMode(row.toolingMode||'BLADE');setMoldId(row.moldUsage?.moldId||'');
    setContext({wireRange:row.contextSnapshot.wireRange||'',equipment:row.contextSnapshot.equipment||'',mold:row.contextSnapshot.mold||''});
    setChoices(row.usages.filter(u=>u.isCurrent).map(u=>choiceFor(u.position,u.bladeId)));
  }
  function applyRecipe(id:string){const recipe=catalog.setups.find(s=>s.id===id);setSetupId(id);setReferenceId(id);if(!recipe){setMoldId('');setChoices([]);setContext({wireRange:'',equipment:'',mold:''});return;}setMode('BLADE');setMoldId('');setContext({wireRange:recipe.wireRange||'',equipment:recipe.equipment||'',mold:recipe.mold||''});setChoices(recipe.positions.map(p=>choiceFor(p.position,p.bladeId)));}
  useEffect(()=>{
    let cancelled=false;setReferences([]);setReferenceId('');modified.current=false;
    if(!terminalId){setLoadingRefs(false);return;}
    setLoadingRefs(true);
    void fetch('/api/terminal-tooling/worklog?terminalId='+encodeURIComponent(terminalId)).then(r=>r.json()).then(body=>{
      if(cancelled)return;if(!body.ok)throw Error(body.error||'历史记录加载失败');setReferences(body.references);
      if(!modified.current){if(body.references[0])applyHistory(body.references[0]);else{const recipe=catalog.setups.find(s=>s.terminalId===terminalId&&s.status==='PUBLISHED');if(recipe)applyRecipe(recipe.id);}}
    }).catch(()=>{if(!cancelled)setError('历史记录暂未加载，可继续手动选择工装');}).finally(()=>{if(!cancelled)setLoadingRefs(false);});
    return()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[terminalId]);
  function changeMode(value:ToolingMode){modified.current=true;setMode(value);setReferenceId('');setSetupId('');setChoices([]);if(value==='BLADE')setMoldId('');}
  function wholeSet(id:string){modified.current=true;const blade=catalog.blades.find(b=>b.id===id),kit=blade?.units.find(u=>u.kitId&&TOOLING_POSITIONS.every(p=>blade.units.some(v=>v.kitId===u.kitId&&v.position===p&&v.state==='AVAILABLE')))?.kitId;setChoices(id?TOOLING_POSITIONS.filter(p=>blade?.compatiblePositions.includes(p)).map(p=>choiceFor(p,id,kit)):[]);}
  function selectTerminal(id:string){const t=catalog.terminals.find(t=>t.id===id);if(!t)return;setTerminalId(id);setSpec(t.specification);setManufacturer(t.manufacturer||'');setSetupId('');setChoices([]);setMoldId('');setMode('BLADE');setContext({wireRange:t.wireRange||'',equipment:'',mold:''});}
  const cta=backfill?(completed?'提交补录':'补记开始并继续计时'):'开始计时';
  async function save(){
    setError('');if(!employeeId){setError('请联系人事将账号绑定员工档案');return;}
    if(activeWork&&!historical){setError('已有作业正在计时，可补录不重叠的已完成时段');return;}
    if(!assist&&!spec.trim()){setError('请输入端子型号');return;}
    if(assist&&!description.trim()){setError('请填写协助内容');return;}
    if(!assist&&mode!=='BLADE'&&!mold){setError('请选择专模型号');return;}
    if(!assist&&mode==='COMBINATION'&&!choices.some(c=>c.bladeId)){setError('请添加至少一个替换刀位');return;}
    if(backfill&&(!start||!Number.isFinite(+new Date(start))||(completed&&(!end||end<=start))||!reason.trim())){setError('请检查起止时间并填写补录原因');return;}
    const result=await submit('worklog',{action:backfill?(completed?'BACKFILL':'BACKSTART'):'START',kind:assist?'ASSIST':'TUNING',toolingMode:mode,terminalId,specification:spec,manufacturer,setupId,...context,moldId:assist||mode==='BLADE'?'':moldId,choices:assist||mode==='MOLD'?[]:choices.filter(c=>c.bladeId),category,description,...(backfill?{startedAt:asShanghai(start),...(completed?{endedAt:asShanghai(end)}:{}),reason}:{})});
    if(result?.jobId)onStarted(String(result.jobId));
  }
  return <ToolingDialog title={assist?'协助报工':readOnly?'查端子与工装':'开始调模'} onClose={onClose} busy={busy} wide className="tl-start-dialog" footer={<><button onClick={onClose} disabled={busy}>{readOnly?'关闭':'取消'}</button>{!readOnly&&<button className="tl-primary" disabled={busy||!employeeId} onClick={()=>void save()}>{backfill?<Check size={18}/>:<Play size={18}/>} {busy?'保存中…':cta}</button>}</>}>
    {error&&<div className="tl-error" role="alert">{error}</div>}
    {!readOnly&&<div className="tl-entry-tabs" role="group" aria-label="记录方式"><button className={!backfill?'active':''} disabled={activeWork} onClick={()=>setBackfill(false)}><Play size={20}/><span>实时计时<small>从现在开始记录</small></span></button><button className={backfill?'active':''} onClick={()=>setBackfill(true)}><Clock3 size={20}/><span>补录时段<small>选择实际工作时间</small></span></button></div>}
    {assist?<section className="tl-form-card"><label>协助类型<select value={category} onChange={e=>setCategory(e.target.value)}>{ASSIST_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><label>工作内容<textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="例如：协助组装、整理刀片" maxLength={500}/></label></section>:<>
      <section className="tl-form-card"><label>端子型号<span className="tl-search"><Search size={18}/><input autoComplete="off" aria-label="端子型号" value={spec} placeholder="搜索或输入新型号" onChange={e=>{setSpec(e.target.value);setTerminalId('');setChoices([]);setSetupId('');setMoldId('');}}/></span></label>
        {!terminalId&&<div className="tl-suggestions">{terminals.map(t=><button key={t.id} onClick={()=>selectTerminal(t.id)}><div><b>{t.specification}</b>{t.manufacturer&&<small>{t.manufacturer}</small>}</div><ArrowRight size={16}/></button>)}{spec.trim()&&!terminals.some(t=>t.specification===spec)&&<span className="tl-inline-note"><Plus size={15}/>自动建档：{spec}</span>}</div>}
        {loadingRefs&&<small role="status">正在读取历史组合…</small>}
        {(references.length>0||recipes.length>0)&&<label>参考记录<select value={referenceId} onChange={e=>{modified.current=true;const id=e.target.value;if(id.startsWith('history:')){const row=references.find(r=>r.id===id.slice(8));if(row)applyHistory(row);}else applyRecipe(id);}}><option value="">本次记录新组合</option>{references.map((r,i)=><option key={r.id} value={'history:'+r.id}>{i===0?'最近使用':'历史'} · {TOOLING_MODES[r.toolingMode||'BLADE']} · {r.moldUsage?.snapshot.model||r.usages.find(u=>u.isCurrent)?.snapshot.model||'未选刀片'} · {asLocal(r.startedAt).replace('T',' ')}</option>)}{recipes.map(s=><option key={s.id} value={s.id}>{s.name} · V{s.version}</option>)}</select></label>}
      </section>
      <div className="tl-mode-tabs" role="group" aria-label="调模方式">{(Object.entries(TOOLING_MODES) as Array<[ToolingMode,string]>).map(([key,label])=><button className={mode===key?'active':''} key={key} onClick={()=>changeMode(key)}>{key==='BLADE'?<Wrench size={18}/>:key==='MOLD'?<BoxIcon/>:<Layers3 size={18}/>} {label}</button>)}</div>
      {mode!=='BLADE'&&<section className="tl-form-card"><h3>{mode==='COMBINATION'?'基础专模':'专模选择'}</h3><label>专模型号<select aria-label="专模型号" value={moldId} onChange={e=>{modified.current=true;setMoldId(e.target.value);}}><option value="">选择专模型号</option>{catalog.molds.filter(m=>historical||m.state!=='RETIRED'||m.id===moldId).map(m=><option key={m.id} value={m.id}>{m.model} · {moldPositionName(m.currentPosition??m.homePosition)} · {TOOLING_STATES[m.state]}</option>)}</select></label>{mold?<div className="tl-pick-summary"><MapPin size={20}/><div><b>{moldPositionName(historical?mold.homePosition:mold.currentPosition??mold.homePosition)}</b><small>{historical?'历史使用记录':mold.state==='AVAILABLE'?'可用 1 套':TOOLING_STATES[mold.state]}</small></div><span className={'tl-tag '+(mold.state==='AVAILABLE'?'green':'amber')}>{historical?'不占用库存':TOOLING_STATES[mold.state]}</span></div>:!catalog.molds.length&&<small>专模库尚未建档，请先在电脑端新增专模。</small>}</section>}
      {mode!=='MOLD'&&<section className="tl-form-card"><div className="tl-card-heading"><h3>{mode==='BLADE'?'刀片选择':'替换刀片'}</h3>{mode==='COMBINATION'&&<button className="tl-text" disabled={choices.length>=4} onClick={()=>{modified.current=true;const position=TOOLING_POSITIONS.find(p=>!choices.some(c=>c.position===p));if(position)setChoices(c=>[...c,{position,bladeId:'',stockId:''}]);}}><Plus size={16}/>添加刀位</button>}</div>
        {mode==='BLADE'&&<label>整套型号<select aria-label="选择整套型号" value={choices.length===4&&new Set(choices.map(c=>c.bladeId)).size===1?choices[0].bladeId:''} onChange={e=>wholeSet(e.target.value)}><option value="">选择整套，或分别选择刀位</option>{catalog.blades.filter(b=>b.isActive).map(b=><option key={b.id} value={b.id}>{b.model} · {b.stock.registered?'可用 '+b.stock.completeKits+' 套':'待盘点'}</option>)}</select></label>}
        <div className={'tl-blade-grid '+(mode==='COMBINATION'?'tl-overrides':'')}>{(mode==='BLADE'?TOOLING_POSITIONS:choices.map(c=>c.position)).map(position=>{
          const choice=choices.find(c=>c.position===position),blade=catalog.blades.find(b=>b.id===choice?.bladeId);
          const units=blade?.units.filter(u=>u.position===position&&(historical||u.state==='AVAILABLE'||(u.state==='IN_USE'&&u.inUseJob?.employeeId===employeeId&&!['RUNNING','PAUSED'].includes(u.inUseJob.status))))||[];
          return <div className="tl-blade-position" key={position}><div className="tl-card-heading">{mode==='COMBINATION'?<select aria-label="替换刀位" value={position} onChange={e=>{modified.current=true;setChoices(cs=>cs.map(c=>c.position===position?{position:e.target.value as ToolingPosition,bladeId:'',stockId:''}:c));}}>{TOOLING_POSITIONS.filter(p=>p===position||!choices.some(c=>c.position===p)).map(p=><option key={p} value={p}>{TOOLING_POSITION_NAMES[p]}</option>)}</select>:<h4>{TOOLING_POSITION_NAMES[position]}</h4>}{mode==='COMBINATION'&&<button className="tl-icon" aria-label={'移除'+TOOLING_POSITION_NAMES[position]} onClick={()=>setChoices(cs=>cs.filter(c=>c.position!==position))}><Trash2 size={16}/></button>}</div>
            <select aria-label={TOOLING_POSITION_NAMES[position]+'型号'} value={choice?.bladeId||''} onChange={e=>{modified.current=true;setChoices(cs=>[...cs.filter(c=>c.position!==position),choiceFor(position,e.target.value)]);}}><option value="">{mode==='BLADE'?'暂不选择':'选择刀片型号'}</option>{catalog.blades.filter(b=>b.isActive&&b.compatiblePositions.includes(position)).map(b=><option key={b.id} value={b.id}>{b.model}</option>)}</select>
            {blade&&<>{blade.positionSpecs.find(s=>s.position===position)?.specification&&<small>{blade.positionSpecs.find(s=>s.position===position)?.specification}</small>}{blade.stock.registered?<select aria-label={TOOLING_POSITION_NAMES[position]+'存放位置'} value={choice?.stockId||''} onChange={e=>{modified.current=true;setChoices(cs=>cs.map(c=>c.position===position?{...c,stockId:e.target.value,reuse:units.find(u=>u.id===e.target.value)?.state==='IN_USE'}:c));}}><option value="">{historical?'仅记录型号':units.length?'选择实物位置':'暂无可用实物'}</option>{units.map(u=><option key={u.id} value={u.id}>{historical?boxName(u.homeBox):u.state==='IN_USE'?'继续使用设备上的刀片':boxName(u.currentBox)} · {u.kit?.code||'散刀 '+u.id.slice(-4)}</option>)}</select>:<span className="tl-tag amber">库存待盘点</span>}</>}
          </div>;
        })}</div>
        {mode==='COMBINATION'&&<small className="tl-original-slots">其余 {4-choices.filter(c=>c.bladeId).length} 个刀位保持专模原配</small>}
      </section>}
    </>}
    {backfill&&!readOnly&&<section className="tl-form-card tl-period-card"><h3><Clock3 size={18}/> 实际工作时段</h3><div className="tl-segment"><button className={completed?'active':''} onClick={()=>setCompleted(true)}>已完成</button><button className={!completed?'active':''} disabled={activeWork} onClick={()=>setCompleted(false)}>仍在进行</button></div><div className="tl-grid2"><label>开始时间<input type="datetime-local" aria-label="开始时间" max={asLocal(new Date())} value={start} onChange={e=>setStart(e.target.value)}/></label>{completed&&<label>结束时间<input type="datetime-local" aria-label="结束时间" max={asLocal(new Date())} value={end} onChange={e=>setEnd(e.target.value)}/></label>}</div><div className="tl-duration-summary"><span>{completed?'本次工时':'已开始'}</span><b>{durationText(Number.isFinite(duration)?duration:0)}</b></div><label>补录原因<input aria-label="补录原因" value={reason} placeholder="例如：忘记点击开始" maxLength={500} onChange={e=>setReason(e.target.value)}/></label><small>{activeWork?'当前有作业计时中，只能补录不重叠的已完成时段。':completed?'只记录历史工时，不改变当前库存。':'提交后继续计时，并占用当前所选工装。'}</small></section>}
    {!assist&&<details className="tl-form-card tl-extra"><summary>补充信息 <small>选填</small></summary><div className="tl-grid2"><label>制造商 / 品牌<input value={manufacturer} disabled={!!terminalId} onChange={e=>setManufacturer(e.target.value)} maxLength={100}/></label><label>适用线径<input value={context.wireRange} onChange={e=>setContext(c=>({...c,wireRange:e.target.value}))} maxLength={100}/></label><label>设备<input value={context.equipment} onChange={e=>setContext(c=>({...c,equipment:e.target.value}))} maxLength={100}/></label>{mode==='BLADE'&&<label>模具备注<input value={context.mold} onChange={e=>setContext(c=>({...c,mold:e.target.value}))} maxLength={100}/></label>}</div></details>}
  </ToolingDialog>;
}
function BoxIcon(){return <Layers3 size={18}/>;}
