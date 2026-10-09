'use client';
import { OrderPoolWorkbench } from './OrderPoolWorkbench';
import type { CurrentUserDTO } from '@/types';
export default function OrderPoolPage({user}:{user:CurrentUserDTO}) {return <main style={{height:'100dvh',display:'flex',flexDirection:'column',padding:16,gap:12,overflow:'hidden'}}><header style={{display:'flex',alignItems:'center',gap:16}}><a href="/home">返回首页</a><h1 style={{fontSize:22,margin:0}}>订单池</h1></header><OrderPoolWorkbench user={user} onChanged={()=>{}} onWeek={()=>{}}/></main>}
