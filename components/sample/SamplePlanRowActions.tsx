'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, History, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import type { SampleTaskDTO } from '@/types';
import { samplePrimaryAction } from '@/lib/sample-workbench-view';
export default function SamplePlanRowActions({task,onReplace,onDelete,onEdit,onOpen,canDelete}:{task:SampleTaskDTO;onReplace:()=>void;onDelete:()=>void;onEdit:()=>void;onOpen:(tab:'documents'|'overview'|'completion'|'review')=>void;canDelete:boolean}) {
 const [menu,setMenu]=useState<{top:number;left:number}|null>(null),ref=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!menu)return;ref.current?.querySelector<HTMLButtonElement>('button')?.focus();const close=(e:Event)=>{if(!ref.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setMenu(null);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setMenu(null);trigger.current?.focus();}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};},[menu]);
 const act=samplePrimaryAction(task);
 function run(fn:()=>void){setMenu(null);fn();}
 return <div className="sd-row-actions"><button className="sd-row-replace" disabled={task.status==='CANCELLED'} onClick={onReplace}><RefreshCw size={13}/>{task.drawingDocumentCount?'替换图纸':'上传图纸'}</button><button aria-label={'图纸与更换记录 '+task.specification} title="图纸与更换记录" onClick={()=>onOpen('documents')}><History size={16}/></button><button ref={trigger} aria-label={'更多操作 '+task.specification} aria-expanded={!!menu} aria-haspopup="menu" onClick={e=>{if(menu){setMenu(null);return;}const r=e.currentTarget.getBoundingClientRect();setMenu({left:Math.min(window.innerWidth-190,r.right-176),top:Math.min(window.innerHeight-190,r.bottom+5)});}}><MoreHorizontal size={17}/></button>
 {menu&&createPortal(<div className="sd-row-menu" ref={ref} role="menu" aria-label={task.specification+' 操作'} style={menu}><button role="menuitem" onClick={()=>run(()=>onOpen(act.tab))}><ArrowUpRight size={16}/>{act.label}</button><button role="menuitem" onClick={()=>run(onEdit)}><Pencil size={16}/>编辑计划</button>{canDelete&&<button role="menuitem" className="sd-danger-item" onClick={()=>run(onDelete)}><Trash2 size={16}/>删除订单</button>}</div>,document.body)}</div>;
}
