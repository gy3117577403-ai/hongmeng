'use client';
import {useState} from 'react';
import {createPortal} from 'react-dom';
import type {QuickQualityDTO} from '@/lib/quality-quick-shared';
import QuickQualityForm from './QuickQualityForm';
import {ActionDialog} from './QuickQualityWorkbench';

export default function QuickWarningActions({id}:{id:string}) {
  const [edit,setEdit]=useState<QuickQualityDTO|null>(null),[command,setCommand]=useState<{action:string;record:QuickQualityDTO}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function start(action:string){if(busy)return;setBusy(true);setError('');try{const r=await fetch('/api/quality-quick/'+id,{cache:'no-store'}),b=await r.json();if(!r.ok)throw Error(b.error);if(action==='EDIT'){if(b.record.escalatedReportId)throw Error('此记录已转入重大异常，请通过“查看快处记录”进入关联异常继续处理。');setEdit(b.record);}else setCommand({action,record:b.record});}catch(e){setError(e instanceof Error?e.message:'加载失败');}finally{setBusy(false);}}
  function changed(){setEdit(null);setCommand(null);window.dispatchEvent(new Event('quality-quick-changed'));}
  async function run(reason:string){if(!command||busy)return;setBusy(true);try{const r=await fetch('/api/quality-quick/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:command.action,version:command.record.version,mutationKey:crypto.randomUUID(),reason})}),b=await r.json();if(!r.ok)throw Error(b.error);changed();}catch(e){setCommand(null);setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}}
  return <div className="drawing-quick-actions"><button disabled={busy} onClick={()=>void start('EDIT')}>编辑普通异常</button><button disabled={busy} onClick={()=>void start('OFFLINE')}>下线警示</button><button disabled={busy} onClick={()=>void start('DELETE')}>删除记录</button>{error&&<p role="alert">{error}</p>}{edit&&createPortal(<QuickQualityForm record={edit} onClose={()=>setEdit(null)} onSaved={changed}/>,document.body)}{command&&createPortal(<ActionDialog value={command} busy={busy} onCancel={()=>setCommand(null)} onSubmit={reason=>void run(reason)}/>,document.body)}</div>;
}
