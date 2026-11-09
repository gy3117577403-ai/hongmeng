import { requirePageAccess } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { purchasingContractTemplates } from '@/lib/purchasing-contract-service';
import { contractContent, type ContractDocument, type ContractLine } from '@/lib/purchasing-contract';
import { pcIds, PurchasingError } from '@/lib/purchasing-domain';
import PurchaseContractEditor from '@/components/purchasing/PurchaseContractEditor';
import '../contract.css';
export const dynamic='force-dynamic';
export default async function EditorPage({searchParams:q}:{searchParams:{ids?:string;revisionOf?:string;template?:string}}) {
  const user=await requirePageAccess('/workspace/purchases'),templateMode=q.template==='1';
  const [templates,settings,previous]=await Promise.all([purchasingContractTemplates(),prisma.pcSettings.findUnique({where:{id:'purchasing'}}),q.revisionOf?prisma.pcContract.findUnique({where:{id:q.revisionOf},include:{lines:true}}):null]);
  const revision=previous?.templateRevision ?? templates.latestRevision;
  let initial=previous?.document?contractContent(previous.document):templates.templates[0]?.content||templates.initial;
  let lines:Array<ContractLine&{version:number}>=[];
  if(!templateMode){const ids=previous?previous.lines.map(l=>l.lineId):pcIds(q.ids?.split(','));const ps=await prisma.pcLine.findMany({where:{id:{in:ids}},include:{supplier:true}});
    if(ps.length!==ids.length||ps.some(p=>!['APPROVED','ORDERED'].includes(p.status)))throw new PurchasingError('合同仅可关联有效的已批准采购');
    if(new Set(ps.map(p=>p.supplierId)).size>1)throw new PurchasingError('请选择同一供应商的采购生成合同');
    const old=previous?.document as unknown as ContractDocument | null;
    lines=ids.map(id=>{const p=ps.find(p=>p.id===id)!,extra=old?.lines.find(l=>l.id===id);return {id:p.id,version:p.version,number:p.number,name:p.name,spec:p.spec,quantity:p.quantity,unit:p.unit,
      amountCents:p.status==='ORDERED'?p.actualCents:p.estimateCents,unitPrice:p.unitPrice?.toString()||null,freightCents:p.freightCents,discountCents:p.discountCents,estimated:p.status!=='ORDERED',brand:extra?.brand||'',deliveryDate:extra?.deliveryDate||'',note:extra?.note||''};});
    if(!previous?.document)initial={...initial,fields:{...initial.fields,date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),supplier:ps[0].supplier?.name||previous?.supplier||'',payee:ps[0].payee,bank:ps[0].bank,account:ps[0].account,deliveryDate:ps[0].eta||initial.fields.deliveryDate}};
  }
  const canEdit=templateMode?!!settings&&(settings.ownerId===user.id||user.laborRole==='ADMIN'):!!settings?.buyerIds.includes(user.id);
  return <PurchaseContractEditor templates={templates} initial={initial} lines={lines} templateMode={templateMode} canEdit={canEdit} number={previous?.number} baseRevision={previous?.revision||0} templateRevision={revision}/>;
}
