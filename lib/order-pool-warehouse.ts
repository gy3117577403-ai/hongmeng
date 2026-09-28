import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { poolSort, poolQuantities } from './order-pool-domain';
import { materialOrderInclude, serializeMaterialOrder } from './material-order-service';
import { chinaDate, chinaWeekRange } from './production-planning';
export async function poolWarehouseQueue(p: URLSearchParams) {
  return prisma.$transaction(async tx => {
    const records=await tx.warehouseMaterialTask.findMany({where:{planOrder:{is:{deletedAt:null,status:{notIn:['cancelled','completed']}}}},include:materialOrderInclude});
    const ordered=poolSort(records.map(t=>({...t,priority:t.planOrder!.priority,preparationRank:t.planOrder!.preparationRank})));
    const all=ordered.filter(t=>{const q=poolQuantities(t.planOrder!.orderQuantity,t.planOrder!.preparationQuantity,t.preparedQuantity,t.planOrder!.batches);return q.remaining>0 || p.get('view')==='tracking' && t.exceptionCases.some(e=>e.status==='OPEN');}).map((t,i)=>({...serializeMaterialOrder(t),preparationRank:i+1}));
    const query=(p.get('q')||'').trim().toLocaleLowerCase(),source=p.get('source')||'ALL';
    const base=all.filter(o=>(p.get('view')!=='tracking'||o.events.length>0)&& (source==='ALL'||o.events.some(e=>e.source===source))&&(!query||[o.specification,o.customer,o.code,...o.events.flatMap(e=>[e.model,e.note,...e.arrivals.map(b=>b.trackingNumber)])].join(' ').toLocaleLowerCase().includes(query)));
    const matches=(o:typeof all[number],s:string)=>s==='active'?o.state!=='READY':s==='ready'?o.state==='READY':s==='waiting'?o.pendingBatches>0:s==='unchecked'?o.state==='UNCHECKED':s==='shortage'?o.openCount>0:s==='unknown'?o.forecast.unknown>0:s==='late'?o.events.some(e=>e.status==='OPEN'&&e.expectedAt&&new Date(e.expectedAt)<new Date()):s==='cancelled'?false:true;
    const summary=Object.fromEntries(['all','active','ready','waiting','unchecked','shortage','unknown','late'].map(s=>[s,base.filter(o=>matches(o,s)).length]));
    const filtered=base.filter(o=>matches(o,p.get('status')||'active')),total=filtered.length,pages=Math.max(1,Math.ceil(total/30)),page=Math.min(pages,Math.max(1,Number(p.get('page'))||1));
    return{orders:filtered.slice((page-1)*30,page*30),summary,older:0,weeks:[],currentWeek:chinaDate(chinaWeekRange(new Date()).start),week:'',pagination:{page,total,pages}};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
