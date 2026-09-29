'use client';
import {useRef,useState} from 'react';
import { DrawingAssociationCell } from '@/components/planning/ImportDrawingAssociation';
import type { ImportDrawingArchive } from '@/lib/import-drawing-association';
import styles from '@/components/planning/ImportReview.module.css';
import {CheckCircle2,FileSpreadsheet,Upload,AlertTriangle,Search} from 'lucide-react';
import type {SamplePlanImportRow} from '@/lib/sample-plan-import';
import {sampleHours} from '@/lib/sample-plan-time';
import {sampleCurrentWeek,sampleWeek} from '@/lib/sample-plan-domain';
import {SampleDialog,sampleRequest} from './SampleBranchControls';

type PlanChoice={mode:'new'|'update'|'skip';taskId?:string;expectedVersion?:number;reason?:string};
type ProductChoice={mode:'create'}|{mode:'reuse';drawingLibraryItemId:string};
type ResultRow={rowNumber:number;status:string;message:string;taskId?:string;existingTaskId?:string;taskCode?:string};
type Result={batchId:string;createdTaskCount:number;updatedTaskCount:number;blockedCount:number;skippedCount:number;rows:ResultRow[]};
export default function SamplePlanImportDialog({week,type,onClose,onCommitted,onViewPlan,suspended=false}:{suspended?:boolean;week:string;type:'NEW'|'REPEAT';onClose:()=>void;onCommitted:(batch:string)=>void;onViewPlan:(id:string)=>void}) {
  const [targetWeek,setTargetWeek]=useState(week || ''),[targetType,setTargetType]=useState(type);
  const [file,setFile]=useState<File|null>(null),[rows,setRows]=useState<SamplePlanImportRow[]|null>(null),[result,setResult]=useState<Result|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState('');
  const [plans,setPlans]=useState<Record<string,PlanChoice>>({}),[products,setProducts]=useState<Record<string,ProductChoice>>({});
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState('');
  const mutation=useRef(crypto.randomUUID());
  const originalArchive=(row:SamplePlanImportRow)=>plans[row.rowNumber]?.mode==='update'?row.existingPlans?.find(p=>p.id===plans[row.rowNumber].taskId)?.drawingLibraryItemId:null;
  const pending=(row:SamplePlanImportRow)=>row.matchStatus!=='BLOCKED'&&plans[row.rowNumber]?.mode!=='skip'&&((row.matchStatus==='CONFIRM'&&!products[row.rowNumber]&&!originalArchive(row))||!!((row.existingPlans?.length||row.duplicateInFile)&&!plans[row.rowNumber]));
  const selectedRows=rows?.filter(row=>row.matchStatus!=='BLOCKED'&&plans[row.rowNumber]?.mode!=='skip')||[];
  const needsReason=Object.values(plans).some(p=>p.mode==='update');
  const visibleRows=rows?.filter(row=>(filter!=='pending'||pending(row)||row.matchStatus==='BLOCKED')&&(filter!=='linked'||row.matchStatus==='REUSE'||products[row.rowNumber]?.mode==='reuse')&&(filter!=='create'||row.matchStatus==='CREATE')&&(!search||[row.specification,row.customerName].some(v=>v.toLowerCase().includes(search.toLowerCase()))))||[];
  function pickArchive(row:SamplePlanImportRow,item:ImportDrawingArchive){setProducts(v=>({...v,[row.rowNumber]:{mode:'reuse',drawingLibraryItemId:item.id}}));setRows(v=>v?.map(r=>r.rowNumber===row.rowNumber?{...r,candidates:[...r.candidates.filter(c=>c.id!==item.id),item]}:r)||null);}
  function retryBlocked(){if(!result)return;const blocked=new Set(result.rows.filter(r=>r.status==='BLOCKED').map(r=>r.rowNumber));setRows(v=>v?.filter(r=>blocked.has(r.rowNumber))||null);setPlans({});setProducts({});setResult(null);setError('');setFilter('all');mutation.current=crypto.randomUUID();}
  const successful=result?.rows.filter(r=>['CREATED','UPDATED'].includes(r.status)) || [];
  async function preview() {
    if(!file||!targetWeek){setError('请选择文件，并明确目标计划周或待排期');return;}
    setBusy(true);setError('');
    try {const form=new FormData();form.append('file',file);form.append('week',targetWeek);form.append('taskType',targetType);
      const body=await sampleRequest('/api/sample-tasks/import/preview',{method:'POST',body:form});setRows(body.rows);setPlans({});setProducts({});mutation.current=crypto.randomUUID();
    } catch(e){setError(e instanceof Error?e.message:'预览失败');}finally{setBusy(false);}
  }
  async function commit() {
    if(!rows)return;
    const unconfirmed=rows.filter(pending);
    if(unconfirmed.length){setError(`请先处理第 ${unconfirmed.map(r=>r.rowNumber).join('、')} 行的资料或批次选择`);return;}
    if(Object.values(plans).some(p=>p.mode==='update')&&!reason.trim()){setError('请填写更新已有计划的原因');return;}
    setBusy(true);setError('');
    const effectiveProducts={...products};for(const row of rows){const id=originalArchive(row);if(id)effectiveProducts[row.rowNumber]={mode:'reuse',drawingLibraryItemId:id};}
    try {const body=await sampleRequest('/api/sample-tasks/import/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientMutationId:mutation.current,fileName:file?.name,rows,decisions:effectiveProducts,planDecisions:Object.fromEntries(Object.entries(plans).map(([key,value])=>[key,{...value,reason}]))})});setResult(body);}
    catch(e){setError(e instanceof Error?e.message:'导入失败，同一请求可安全重试');}finally{setBusy(false);}
  }
  function exportResults(){if(!result)return;const cell=(v:unknown)=>`"${String(v??'').replace(/^[\s]*([=+@-])/,'\'$1').replace(/"/g,'""')}"`;const csv='\uFEFF'+[['源文件', 'Excel 行','结果','说明','样品计划编号'],...result.rows.map(row=>[file?.name,row.rowNumber,row.status,row.message,row.taskCode])].map(row=>row.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='样品计划导入逐行结果.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(suspended)return null;
  return <SampleDialog title={result?'样品计划导入结果':'批量导入样品计划'} className={`import-workbench sample-import-workbench ${rows?'import-step-preview':'import-step-upload'}`} wide busy={busy} onClose={onClose}>
    <nav className="planning-import-steps" aria-label="导入步骤"><span className={!rows?'active':'done'}><b>1</b>上传模板</span><i/><span className={rows&&!result?'active':result?'done':''}><b>2</b>核对与确认</span><i/><span className={result?'active':''}><b>3</b>导入完成</span></nav>
    <div className="import-workbench-body">
      {!rows&&!result&&<>
        <div className="spr-import-target"><label>样品类型<select value={targetType} onChange={e=>setTargetType(e.target.value as 'NEW'|'REPEAT')}><option value="NEW">新品试制</option><option value="REPEAT">老产品制作</option></select></label><label>导入到<select value={targetWeek==='unplanned'?'unplanned':targetWeek?'dated':''} onChange={e=>setTargetWeek(e.target.value==='dated'?sampleCurrentWeek():e.target.value)}><option value="">请选择计划周</option><option value="dated">指定计划周</option><option value="unplanned">待排期</option></select></label>{targetWeek&&targetWeek!=='unplanned'&&<label>计划周日期<input type="date" value={targetWeek} onChange={e=>setTargetWeek(e.target.value?sampleWeek(e.target.value)!:'')}/></label>}</div>
        <label className="planning-import-picker"><FileSpreadsheet/><span><strong>{file?.name||'选择已填写的样品计划模板'}</strong><small>Excel · 单套工时单位为分钟 · 文件内的类型和计划周优先</small></span><b>选择文件</b><input aria-label="选择样品计划文件" type="file" accept=".xlsx" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/></label><div className="planning-import-tools"><a href="/api/sample-tasks/import/template" download><FileSpreadsheet size={16}/>下载样品计划模板</a></div>
      </>}
      {rows&&!result&&<>
        <div className={styles.summary}><FileSpreadsheet size={17}/><strong>{file?.name}</strong><span>{targetWeek==='unplanned'?'待排期':`计划周 ${targetWeek}`} · {targetType==='NEW'?'新品试制':'老产品制作'}</span></div>
        <section className={styles.review} aria-label="样品导入核对"><div className={styles.toolbar}>
          {([['all','全部',rows.length],['linked','已匹配资料',rows.filter(r=>r.matchStatus==='REUSE'||products[r.rowNumber]?.mode==='reuse').length],['create','待建档',rows.filter(r=>r.matchStatus==='CREATE').length],['pending','待处理',rows.filter(r=>pending(r)||r.matchStatus==='BLOCKED').length]] as const).map(([key,label,count])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label} {count}</button>)}
          <label><Search size={17}/><input aria-label="搜索导入样品" placeholder="搜索客户 / 产品规格" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        </div><div className={styles.tableScroll}><table className={styles.table}><colgroup><col style={{width:'4%'}}/><col style={{width:'19%'}}/><col style={{width:'6%'}}/><col style={{width:'13%'}}/><col style={{width:'9%'}}/><col style={{width:'22%'}}/><col style={{width:'17%'}}/><col style={{width:'10%'}}/></colgroup><thead><tr><th>行</th><th>客户 / 产品规格</th><th>数量</th><th>单套 / 总工时</th><th>计划周 / 交期</th><th>关联图纸资料库</th><th>计划处理</th><th>校验</th></tr></thead><tbody>{visibleRows.map(row=>{
          const choice=plans[row.rowNumber],target=choice?.mode==='update'?row.existingPlans?.find(p=>p.id===choice.taskId):null;
          const product=products[row.rowNumber];
          const archiveId=target?.drawingLibraryItemId||(product?.mode==='reuse'?product.drawingLibraryItemId:row.matchedItemId);
          const archive=row.candidates.find(c=>c.id===archiveId);
          const minutes=row.unitPlannedMinutes??target?.unitPlannedMinutes;
          const skipped=choice?.mode==='skip', blocked=row.matchStatus==='BLOCKED';
          return <tr key={row.rowNumber} className={blocked?styles.errorRow:skipped?styles.skipped:''}>
            <td>{!blocked&&<input type="checkbox" aria-label={`导入样品第 ${row.rowNumber} 行`} checked={!skipped} disabled={busy} onChange={e=>setPlans(v=>{const next={...v};if(e.target.checked)delete next[row.rowNumber];else next[row.rowNumber]={mode:'skip'};return next;})}/>}<small>{row.rowNumber}</small></td>
            <td><strong>{row.specification||'无效数据行'}</strong><small>{row.customerName} · {row.taskType==='REPEAT'?'老产品制作':'新品试制'}</small>{row.sourceOrderNo&&<small>订单 {row.sourceOrderNo}</small>}</td>
            <td><strong>{row.sampleQuantity}</strong><small>套</small>{target&&target.sampleQuantity!==row.sampleQuantity&&<small className={styles.diff}>原 {target.sampleQuantity}</small>}</td>
            <td>{minutes!=null?<><strong>{Number(minutes.toFixed(3))} 分/套</strong><small>{sampleHours(Math.round(minutes*60000)*row.sampleQuantity)} h</small><small>{row.unitPlannedMinutes==null?'保留原计划工时':'本次导入'}</small></>:<span className={styles.warn}>工时待补</span>}{target&&row.unitPlannedMinutes!=null&&target.unitPlannedMinutes!==row.unitPlannedMinutes&&<small className={styles.diff}>原 {target.unitPlannedMinutes??'未填'} 分/套</small>}</td>
            <td>{row.planWeekStartDate?.slice(5)||'待排期'}<small>交期 {row.dueDate?.slice(5)||'—'}</small>{target&&target.planWeekStartDate!==row.planWeekStartDate&&<small className={styles.diff}>原周 {target.planWeekStartDate?.slice(5)||'待排期'}</small>}</td>
            <td>{!blocked?<DrawingAssociationCell disabled={busy} customerName={row.customerName} specification={row.specification} archive={archive||(archiveId?{id:archiveId,libraryKey:'',customerName:row.customerName,specification:row.specification,productName:row.productName}:null)} locked={!!target} pending={row.matchStatus==='CONFIRM'&&!archiveId} onPick={item=>pickArchive(row,item)}/>:<small>—</small>}</td>
            <td>{!blocked&&<><select aria-label={`第${row.rowNumber}行计划处理`} disabled={busy} value={choice?.mode==='update'?choice.taskId:choice?.mode||(row.existingPlans?.length||row.duplicateInFile?'':'new')} onChange={e=>{const picked=row.existingPlans?.find(p=>p.id===e.target.value);setPlans(v=>{const next={...v};if(!e.target.value)delete next[row.rowNumber];else next[row.rowNumber]=picked?{mode:'update',taskId:picked.id,expectedVersion:picked.version}:{mode:e.target.value as 'new'|'skip'};return next;});}}>{!!(row.existingPlans?.length||row.duplicateInFile)&&<option value="">确认是否重复</option>}{!row.planCode&&!(row.sourceOrderNo&&row.existingPlans?.length)&&<option value="new">新建独立计划</option>}<option value="skip">跳过本行</option>{row.existingPlans?.filter(p=>!['COMPLETED','CANCELLED'].includes(p.status)).map(p=><option key={p.id} value={p.id}>更新 {p.code} · {p.sampleQuantity} 套</option>)}</select>{row.duplicateInFile&&<small className={styles.warn}>与第 {row.duplicateInFile} 行重复</small>}{row.existingPlans?.map(p=><button type="button" className={styles.link} key={p.id} onClick={()=>onViewPlan(p.id)}>查看 {p.code}</button>)}</>}</td>
            <td>{blocked?<><span className={styles.warn}>待修正</span><small>{row.message}</small></>:skipped?<small>已跳过</small>:pending(row)?<><span className={styles.pending}>待确认</span><small>{row.matchStatus==='CONFIRM'&&!archiveId?'选择资料档案':'核对计划处理'}</small></>:<><span className={styles.status}><CheckCircle2 size={14}/>可导入</span>{!archive?.drawingFileCount&&<small className={styles.warn}>图纸待上传</small>}</>}</td>
          </tr>;
        })}</tbody></table>{!visibleRows.length&&<div className={styles.empty}>没有符合条件的行<button className={styles.link} onClick={()=>{setSearch('');setFilter('all');}}>显示全部</button></div>}</div></section>
        {needsReason&&<label className={styles.updateReason}>更新原因<input aria-label="更新已有计划的原因" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：客户调整数量和交期"/></label>}
      </>}
      {result&&<>
        <div className="spr-import-result"><CheckCircle2 size={28}/><strong>已导入 {successful.length} 项</strong><span>新建 {result.createdTaskCount} · 更新 {result.updatedTaskCount} · 跳过 {result.skippedCount} · 未成功 {result.blockedCount}</span></div>
        <div className={styles.tableScroll}><table className={styles.table} style={{minWidth:700}}><thead><tr><th>Excel 行</th><th>结果</th><th>说明</th><th>记录</th></tr></thead><tbody>{result.rows.map(row=><tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{({CREATED:'已新建',UPDATED:'已更新',SKIPPED:'已跳过',BLOCKED:'未成功'} as Record<string,string>)[row.status]||row.status}</td><td>{row.message}</td><td>{(row.taskId||row.existingTaskId)&&<button className={styles.link} onClick={()=>onViewPlan((row.taskId||row.existingTaskId)!)}>{row.taskCode||'查看已有计划'}</button>}</td></tr>)}</tbody></table></div>
      </>}
      {error&&<div className={styles.error} role="alert"><AlertTriangle size={17}/>{error}</div>}
    </div>
    <footer><span>{result?`本次成功 ${successful.length} 项`:rows?`${selectedRows.length} 行待导入${rows.some(pending)?' · 请先处理待确认行':''}${rows.some(r=>r.matchStatus==='BLOCKED')?' · 错误行保留在结果中':''}`:'单套工时 × 数量 = 总计划工时'}</span><div>{result?<><button onClick={exportResults}>导出结果</button>{!!result.blockedCount&&<button onClick={retryBlocked}>处理未成功行</button>}<button className="sb-primary" disabled={!successful.length} onClick={()=>onCommitted(result.batchId)}>查看本次导入 {successful.length} 项</button></>:<><button disabled={busy} onClick={()=>rows?setRows(null):onClose()}>{rows?'上一步':'取消'}</button><button className="sb-primary" disabled={busy||(!rows&&(!file||!targetWeek))||!!rows&&(!selectedRows.length||rows.some(pending)||(needsReason&&!reason.trim()))} onClick={()=>void(rows?commit():preview())}><Upload size={16}/>{busy?'正在处理…':rows?`确认导入 ${selectedRows.length} 行`:'读取并预览'}</button></>}</div></footer>
  </SampleDialog>;
}
