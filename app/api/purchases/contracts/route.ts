import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { purchasingError } from '@/lib/purchasing-http';
import { purchasingContractTemplates } from '@/lib/purchasing-contract-service';
import { purchasingContract } from '@/lib/purchasing-queries';
import { contractContent, type ContractDocument } from '@/lib/purchasing-contract';
import { contractPdf, contractWorkbook } from '@/lib/purchasing-contract-export';
import { PurchasingError } from '@/lib/purchasing-domain';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
  try {await requireUser();const q=req.nextUrl.searchParams,format=q.get('format');
    if(q.has('id')) {const c=await purchasingContract(q.get('id')!);
      if(!format)return NextResponse.json({ok:true,data:c});
      if(!c.document)throw new PurchasingError('历史合同请使用原合同页面的打印和下载入口');
      const document=c.document as unknown as ContractDocument,print={...c,document};
      const bytes=format==='pdf'?await contractPdf(print):format==='xlsx'?Buffer.from(await contractWorkbook(document,print).xlsx.writeBuffer()):null;
      if(!bytes)throw new PurchasingError('不支持的下载格式');
      return new NextResponse(bytes,{headers:{'Content-Type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(c.number+'-V'+c.revision+'.'+format)}`,'Cache-Control':'no-store'}});
    }
    const result=await purchasingContractTemplates();
    if(format==='xlsx'){const revision=Number(q.get('revision')||result.latestRevision);const content=revision?result.templates.find(t=>t.revision===revision)?.content:result.initial;if(!content)throw new PurchasingError('模板版本不存在');return new NextResponse(Buffer.from(await contractWorkbook(contractContent(content)).xlsx.writeBuffer()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('采购合同模板-V'+revision+'.xlsx')}`,'Cache-Control':'no-store'}});}
    return NextResponse.json({ok:true,data:result});
  }catch(e){return purchasingError(e);}
}
