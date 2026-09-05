'use client';
/* eslint-disable @next/next/no-img-element */
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createSopPdfBlob } from '@/components/sop/pdf';
import { QUALITY_LABELS, CONTEXT_FIELDS, RESULT_LABELS, REVIEW_LABELS, beijingInput, type QualityRecord } from '@/lib/quality-data';
import { qualityRequest } from './client';
function printTextParts(text: string) {
  const parts: string[] = []; let part = '', lines = 0;
  for (const character of text) {
    part += character; if (character === '\n') lines++;
    if (part.length >= 500 || lines >= 20) { parts.push(part); part = ''; lines = 0; }
  }
  if (part) parts.push(part);
  return parts;
}
export default function QualityDataPrint({ id, version }: { id: string; version?: string }) {
  const [record,setRecord] = useState<QualityRecord|null>(null),[error,setError] = useState(''),[busy,setBusy] = useState(false),[groups,setGroups] = useState<number[][]>([]);
  const measure = useRef<HTMLDivElement>(null), pages = useRef<HTMLDivElement>(null);
  useEffect(()=>{ qualityRequest<QualityRecord>('records/'+id+(version?'/revisions/'+encodeURIComponent(version):'')).then(setRecord).catch(e=>setError(e.message)); },[id,version]);
  const atoms = useMemo<ReactNode[]>(()=>{
    if(!record)return [];
    const r=record, o=r.orderSnapshot, attachmentVersion=version || (r.deletedAt ? String(r.version) : '');
    const result:ReactNode[]=[
      <div key="order" className="qd-print-order"><h2>{r.title}</h2><p>{o.productName} / {o.specification || ''}</p><p>订单：{o.sourceOrderNo || '未关联'}　订单行：{o.sourceLineNo ?? '—'}　生产批次：{o.batchNo ?? '历史工单'}</p><p>工单：{o.businessCode || o.code}　客户：{o.customerName || '—'}</p><p>检验时间：{beijingInput(r.inspectedAt).replace('T',' ')}　填写人：{r.createdByName}</p><p>结论：{RESULT_LABELS[r.result]}　状态：{r.deletedAt?'已作废':r.status==='DRAFT'?'草稿':'已提交'}　{REVIEW_LABELS[r.reviewStatus]}</p>{r.deleteReason&&<p>作废原因：{r.deleteReason}</p>}</div>,
      ...CONTEXT_FIELDS.filter(([k])=>r.data.context[k]).map(([k,l])=><div key={k} className="qd-print-field"><b>{l}</b><span>{r.data.context[k]}</span></div>),
      <h3 key="measure-heading">检查与测量明细</h3>,
      ...r.data.rows.map((row,i)=><div key={'row'+i} className="qd-print-measure"><header><b>{i+1}. {row.item}</b><strong>{RESULT_LABELS[row.result]}</strong></header><p>样本：{row.sample || '—'}　位置 / 线号：{row.position || '—'}</p><p>检验依据：{row.standard || '未填写'}{(row.lower||row.upper)&&'　标准范围：'+(row.lower||'不限')+' ～ '+(row.upper||'不限')+' '+row.unit}</p><p>实测 / 检查结果：<b>{row.value || '未填写'} {row.unit}</b></p>{row.note&&<p>备注：{row.note}</p>}</div>),
      ...printTextParts(r.data.summary).map((part,i)=><div key={'summary'+i}><h3>{i?'内容摘要（续）':'内容摘要 / 异常说明'}</h3><p className="qd-print-text">{part}</p></div>),
      <div key="review"><p>复核：{r.reviewedByName || '未复核'}　{r.reviewedAt?beijingInput(r.reviewedAt).replace('T',' '):''}</p><p>{r.reviewNote || ''}</p><p>系统提交：{r.submittedAt?beijingInput(r.submittedAt).replace('T',' '):'尚未提交'}　模板版本：{r.templateVersion}</p></div>,
      <h3 key="files-heading">原始附件</h3>,
      ...r.attachments.filter(file=>!file.deletedAt).map(file=><div key={file.id} className="qd-print-attachment"><b>{file.originalName}</b>{file.mimeType.startsWith('image/')&&<img alt={file.originalName} src={'/api/quality-data/attachments/'+file.id+'/content'+(attachmentVersion?'?historyVersion='+attachmentVersion:'')}/>}<small>SHA-256：{file.sha256}</small></div>),
    ];
    return result;
  },[record,version]);
  useEffect(()=>{
    if(!measure.current||!atoms.length)return;
    let active=true;
    (async()=>{
      await document.fonts.ready;
      const images=Array.from(measure.current!.querySelectorAll('img'));
      await Promise.all(images.map(image=>image.complete ? image.naturalWidth?Promise.resolve():Promise.reject(new Error('附件图片加载失败')) : new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('图片加载超时，请重试')),20000);
        image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(new Error('附件图片加载失败'));};
      })));
      if(!active)return;
      const blocks=Array.from(measure.current!.children) as HTMLElement[];
      const result:number[][]=[];let group:number[]=[],height=0;
      blocks.forEach((block,i)=>{
        const size=Math.ceil(block.getBoundingClientRect().height);
        if(size>965)throw new Error('单项内容超出一页，请缩短该项说明后重试');
        const nextSize=block.firstElementChild?.tagName==='H3'&&blocks[i+1]?Math.ceil(blocks[i+1].getBoundingClientRect().height):0;
        if(height+size+nextSize>965&&group.length){result.push(group);group=[];height=0;}
        group.push(i);height+=size;
      });
      if(group.length)result.push(group);setGroups(result);
    })().catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[atoms]);
  async function download(){
    if(!pages.current||!record)return;setBusy(true);setError('');
    try{
      const blob=await createSopPdfBlob(pages.current),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=record.code+'-V'+record.version+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }catch(e){setError(e instanceof Error?e.message:'PDF导出失败');}finally{setBusy(false);}
  }
  return <main className="qd-print-root"><div className="qd-print-toolbar"><b>质量检验报告</b><button className="qd-primary" disabled={!groups.length||busy} onClick={()=>void download()}>{busy?'正在生成 PDF…':'下载 PDF'}</button><button disabled={!groups.length} onClick={()=>window.print()}>打印</button><span>{groups.length} 页 · 北京时间</span>{error&&<p role="alert">{error}</p>}</div>
    <div ref={measure} className="qd-print-measurement" aria-hidden="true">{atoms.map((atom,i)=><div className="qd-print-block" key={i}>{atom}</div>)}</div>
    <div ref={pages}>{groups.map((group,i)=><article className="qd-print-page" data-sop-export-page key={i}><header><b>杭连协同平台 · {record&&QUALITY_LABELS[record.type]}</b><span>{record?.code} · V{record?.version}</span></header><div className="qd-print-page-body">{group.map(j=><div className="qd-print-block" key={j}>{atoms[j]}</div>)}</div><footer><span>{record?.deletedAt?'已作废记录 · 仅供追溯':record?.status==='DRAFT'?'草稿 · 尚未提交':'按本批工单归档'} · 导出 {beijingInput().replace('T',' ')}</span><span>第 {i+1} / {groups.length} 页</span></footer></article>)}</div>
  </main>;
}
