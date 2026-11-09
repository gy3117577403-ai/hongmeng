'use client';
import { useEffect, useRef, useState } from 'react';
import { CONTRACT_FIELDS, contractProblems, type ContractContent, type ContractField, type ContractDocument, type ContractLine } from '@/lib/purchasing-contract';
import type { purchasingContractTemplates } from '@/lib/purchasing-contract-service';
import { pcMoney } from '@/lib/purchasing-domain';
import ContractDocumentView from './ContractDocumentView';

type Templates=Awaited<ReturnType<typeof purchasingContractTemplates>>;
type EditorLine=ContractLine&{version:number};
export default function PurchaseContractEditor({templates,initial,lines,templateMode,canEdit,number:initialNumber='',baseRevision=0,templateRevision:initialRevision=0}: {
  templates:Templates;initial:ContractContent;lines:EditorLine[];templateMode:boolean;canEdit:boolean;number?:string;baseRevision?:number;templateRevision?:number;
}) {
  const [content,setContent]=useState(initial),[number,setNumber]=useState(initialNumber),[lineDetails,setLineDetails]=useState(lines),[templateRevision,setTemplateRevision]=useState(initialRevision);
  const [name,setName]=useState('对公采购合同'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState(false),[dirty,setDirty]=useState(false);
  const mutation=useRef<{body:string;key:string}|null>(null),busyRef=useRef(false);
  const change=(fn:(c:ContractContent)=>ContractContent)=>{setContent(fn);setDirty(true);};
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty&&!busyRef.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  const document:ContractDocument={...content,schemaVersion:1,lines:lineDetails,amountCents:lines.reduce((n,l)=>n+l.amountCents,0)};
  async function save(status:string) {
    if(busyRef.current||!canEdit)return;setError('');
    if(!templateMode&&status==='FINAL'){const missing=contractProblems(content,lineDetails);if(missing.length){setError('定稿前请补全：'+missing.join('、'));return;}}
    if(!templateMode&&!number.trim()){setError('请填写合同编号');return;}
    const payload=templateMode?{action:'SAVE_CONTRACT_TEMPLATE',name,content,templateRevision:templates.latestRevision}:{action:'CONTRACT',contractNumber:number,baseRevision,templateRevision,documentStatus:status,document:content,
      entries:lines.map(l=>({id:l.id,version:l.version})),lineDetails:lineDetails.map(l=>({id:l.id,brand:l.brand||'',deliveryDate:l.deliveryDate||'',note:l.note||''}))};
    const body=JSON.stringify(payload);if(mutation.current?.body!==body)mutation.current={body,key:crypto.randomUUID()};
    setBusy(true);busyRef.current=true;
    try {const response=await fetch('/api/purchases',{method:'POST',headers:{'Content-Type':'application/json','idempotency-key':mutation.current.key},body});const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'保存失败');setDirty(false);
      location.assign(templateMode?'/workspace/purchases/contracts/editor?template=1&saved=1':'/workspace/purchases/contracts/'+result.data.id);
    }catch(e){setError(e instanceof Error?e.message:'保存失败，请保留输入并重试');busyRef.current=false;setBusy(false);}
  }
  const field=(key:ContractField,label:string)=>{const multiline=['purchaserAddress','supplierAddress','deliveryAddress','shippingTerms','qualityStandard','paymentTerms','dispute','specialTerms'].includes(key);return <label key={key} className={multiline?'ce-wide':''}>{label}{multiline?<textarea aria-label={label} rows={key==='specialTerms'?4:2} value={content.fields[key]} onChange={e=>change(c=>({...c,fields:{...c.fields,[key]:e.target.value}}))}/>:<input aria-label={label} type={key==='date'?'date':key==='taxRate'?'number':'text'} step={key==='taxRate'?'0.0001':undefined} min={key==='taxRate'?0:undefined} max={key==='taxRate'?99:undefined} value={content.fields[key]} onChange={e=>change(c=>({...c,fields:{...c.fields,[key]:e.target.value}}))}/>}</label>;};
  return <main className="contract-editor">
    <header><a href="/workspace/purchases">← 返回采购工作台</a><div><h1>{templateMode?'通用合同模板':'编辑本份采购合同'}</h1><p>{templateMode?'保存后生成新模板版本，历史合同保持原样。':'保存为独立合同版本，不修改通用模板或采购金额。'}</p></div><button onClick={()=>setPreview(v=>!v)}>{preview?'返回编辑':'预览合同'}</button></header>
    {!canEdit&&<p className="ce-banner">当前为只读查看；{templateMode?'采购配置维护人或管理员':'采购经办人'}可保存修改。</p>}
    {error&&<p role="alert" className="ce-error">{error}</p>}
    {preview?<ContractDocumentView document={document} number={number} revision={baseRevision+1}/>:<fieldset disabled={!canEdit||busy}>
      <section className="ce-section"><h2>{templateMode?'模板版本':'合同信息'}</h2><div className="ce-grid">
        {templateMode?<label>模板名称<input value={name} onChange={e=>{setName(e.target.value);setDirty(true);}}/></label>:<label>合同编号<input value={number} disabled={baseRevision>0} onChange={e=>{setNumber(e.target.value);setDirty(true);}}/></label>}
        <label>{templateMode?'载入历史模板内容':'选择模板'}<select aria-label={templateMode ? "载入历史模板内容" : "选择模板"} value={templateRevision} onChange={e=>{if(dirty&&!window.confirm('载入模板将替换当前未保存的条款和默认字段，是否继续？'))return;const revision=Number(e.target.value),next=revision?templates.templates.find(t=>t.revision===revision)!.content:templates.initial;setTemplateRevision(revision);change(c=>({...next,fields:templateMode?{...next.fields}:{...next.fields,supplier:c.fields.supplier,date:c.fields.date,payee:c.fields.payee,bank:c.fields.bank,account:c.fields.account}}));}}><option value={0}>初始模板</option>{templates.templates.map(t=><option value={t.revision} key={t.id}>V{t.revision} · {t.name} · {t.actorName}</option>)}</select></label>
        <p className="ce-wide ce-muted">{templateMode?`当前生效版本 V${templates.latestRevision}；选择旧版内容后保存，会追加为新版本。`:`本份合同 V${baseRevision+1}，模板 V${templateRevision}。金额取自采购明细；预估金额仅可保存草稿。`}</p>
        {templateMode&&<a href={'/api/purchases/contracts?format=xlsx&revision='+templateRevision}>下载当前已保存的 Excel 模板</a>}
      </div></section>
      <section className="ce-section"><h2>主体与履约信息</h2><div className="ce-grid">{CONTRACT_FIELDS.map(([key,label])=>field(key,label))}</div></section>
      {!templateMode&&<section className="ce-section"><h2>采购明细 · 合计 {pcMoney(document.amountCents)}</h2><div className="ce-table"><table><thead><tr><th>品名 / 规格</th><th>数量</th><th>金额</th><th>品牌</th><th>交期</th><th>备注</th></tr></thead><tbody>{lineDetails.map((l,i)=><tr key={l.id}><td>{l.name}<small>{l.spec}</small></td><td>{l.quantity} {l.unit}</td><td>{pcMoney(l.amountCents)}{l.estimated&&<small>预估</small>}</td>{(['brand','deliveryDate','note'] as const).map(k=><td key={k}><input aria-label={`${l.number} ${k==='brand'?'品牌':k==='note'?'备注':'交期'}`} value={l[k]||''} onChange={e=>{setDirty(true);setLineDetails(old=>old.map((v,j)=>j===i?{...v,[k]:e.target.value}:v));}}/></td>)}</tr>)}</tbody></table></div></section>}
      <section className="ce-section"><h2>合同条款</h2><p className="ce-muted">正文可直接修改。双花括号字段会替换为上方填写的内容；可调整顺序或添加特别条款。</p>
        {content.clauses.map((clause,i)=><details className="ce-clause" key={clause.id}><summary>{clause.title}</summary><label>条款标题<input aria-label="条款标题" value={clause.title} onChange={e=>change(c=>({...c,clauses:c.clauses.map((v,j)=>j===i?{...v,title:e.target.value}:v)}))}/></label><label>条款正文<textarea aria-label="条款正文" rows={6} value={clause.body} onChange={e=>change(c=>({...c,clauses:c.clauses.map((v,j)=>j===i?{...v,body:e.target.value}:v)}))}/></label><div className="ce-clause-tools"><button disabled={!i} onClick={()=>change(c=>{const clauses=[...c.clauses];[clauses[i-1],clauses[i]]=[clauses[i],clauses[i-1]];return {...c,clauses};})}>上移</button><button disabled={i===content.clauses.length-1} onClick={()=>change(c=>{const clauses=[...c.clauses];[clauses[i],clauses[i+1]]=[clauses[i+1],clauses[i]];return {...c,clauses};})}>下移</button><button disabled={content.clauses.length<=1} onClick={()=>change(c=>({...c,clauses:c.clauses.filter((_,j)=>j!==i)}))}>删除此条</button></div></details>)}
        <button onClick={()=>change(c=>({...c,clauses:[...c.clauses,{id:crypto.randomUUID(),title:'补充条款',body:'请填写双方确认的补充约定。'}]}))}>＋ 添加条款</button>
      </section>
    </fieldset>}
    <footer><span>{templateMode?'模板修改只用于后续新合同。':'定稿前检查主体、交付、验收、质保、退款、付款与开票约定。'}{dirty?' 有未保存内容。':''}</span>{!templateMode&&<button disabled={busy||!canEdit} onClick={()=>void save('DRAFT')}>保存合同草稿</button>}<button className="ce-primary" disabled={busy||!canEdit} onClick={()=>void save('FINAL')}>{busy?'保存中…':templateMode?'保存为新模板版本':'确认定稿并保存'}</button></footer>
  </main>;
}
