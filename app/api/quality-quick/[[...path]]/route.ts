import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { quickUser, quickReader, quickError } from '@/lib/quality-quick-http';
import { quickList, quickSummary, quickDetail, quickDrawingOptions, quickWarningsForOrders, quickWarningsForProduct, quickInclude, quickEffective, quickCommand, saveQuick, QuickQualityError, type QuickUpload } from '@/lib/quality-quick';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { getObjectStream, putObject, deleteObjectsBestEffort } from '@/lib/s3';
import { qualityFileType } from '@/lib/quality-data-files';
import { readQualityImageGeometry } from '@/lib/quality-image-metadata';
export const dynamic='force-dynamic';
export const runtime='nodejs';
type Context={params:{path?:string[]}};
export async function GET(req:NextRequest,{params}:Context) {
  try {
    const path=params.path||[], p=req.nextUrl.searchParams;
    if(path[0]==='warnings') {
      await quickReader();
      const orderId=p.get('workOrderId'),productId=p.get('productId');
      const rows=orderId?(await quickWarningsForOrders([orderId])).get(orderId)||[]:productId?await quickWarningsForProduct(productId):[];
      return NextResponse.json({ok:true,rows},{headers:{'Cache-Control':'private, no-store'}});
    }
    if(path[0]==='photos'&&path[1]) {
      const user=await quickReader();
      const photo=await prisma.quickQualityAttachment.findUnique({where:{id:path[1]},include:{record:{include:quickInclude}}});
      if(!photo) throw new QuickQualityError('图片不存在',404);
      const manager=user.laborRole==='ADMIN'||user.access.capabilities.includes('QUALITY:READ');
      if(!manager&&(photo.deletedAt||!quickEffective(photo.record))) {
        const version=Number(p.get('revision'));
        const mayPrint=user.access.capabilities.includes('PRODUCTION:EXECUTE_WORKFLOW');
        const revision=mayPrint&&Number.isSafeInteger(version)&&version>0?await prisma.quickQualityActivity.findUnique({where:{recordId_version:{recordId:photo.recordId,version}}}):null;
        const snapshot=revision?.snapshot as {photos?:Array<{id:string}>}|undefined;
        if(!snapshot?.photos?.some(f=>f.id===photo.id)) throw new QuickQualityError('警示已下线或图片已移除',404);
      }
      const body=Readable.toWeb(await getObjectStream(photo.objectKey)) as ReadableStream;
      return new NextResponse(body,{headers:{'Content-Type':photo.mimeType,'Content-Length':String(photo.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    await quickUser();
    if(path[0]==='summary') return NextResponse.json({ok:true,...await quickSummary()});
    if(path[0]==='options') {
      let ids=(p.get('ids')||'').split(',').filter(Boolean).slice(0,20);
      const code=p.get('code');
      if(code) {
        const ticket=await prisma.workOrderQrTicket.findFirst({where:{publicCode:code,status:'ACTIVE'},select:{workOrderId:true}});
        if(!ticket) throw new QuickQualityError('工单二维码不存在或已失效',404);
        ids=[ticket.workOrderId];
      }
      let productId=p.get('productId')||undefined;
      if(ids.length){
        const orders=await prisma.workOrder.findMany({where:{id:{in:ids},deletedAt:null},select:{drawingLibraryItemId:true}});
        const products=[...new Set(orders.map(o=>o.drawingLibraryItemId))];
        if(orders.length!==ids.length||products.length!==1||!products[0]) throw new QuickQualityError('来源工单尚未关联同一份图纸，请选择图纸档案');
        productId=products[0];
      }
      const rows=await quickDrawingOptions((p.get('q')||'').trim().slice(0,150),productId);
      if(productId&&!rows.length) throw new QuickQualityError('关联图纸已删除或不存在，请选择有效图纸');
      return NextResponse.json({ok:true,rows,sourceOrderIds:ids});
    }
    if(path[0]) return NextResponse.json({ok:true,record:await quickDetail(path[0],true)});
    return NextResponse.json({ok:true,...await quickList(p)});
  }catch(e){return quickError(e);}
}
export async function POST(req:NextRequest,{params}:Context) {
  const staged:string[]=[]; let committed=false;
  try {
    assertSameOriginMutationRequest(req);
    const {actor}=await quickUser(true), path=params.path||[];
    if(path[0]) {
      const raw=await req.text(); if(raw.length>10000) throw new QuickQualityError('请求过大',413);
      const input=JSON.parse(raw);
      if(!input||typeof input!=='object'||Array.isArray(input)) throw new QuickQualityError('请求格式不正确');
      return NextResponse.json({ok:true,record:await quickCommand(actor,path[0],input)});
    }
    if(Number(req.headers.get('content-length'))>36*1024*1024) throw new QuickQualityError('单次上传总大小不能超过 32 MB',413);
    const form=await req.formData(), raw=String(form.get('data')||'');
    if(raw.length>20000) throw new QuickQualityError('表单内容过长',413);
    const input=JSON.parse(raw) as Record<string,unknown>, files=form.getAll('photos');
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new QuickQualityError('表单格式不正确');
    if(files.length>12) throw new QuickQualityError('最多上传 12 张照片');
    let total=0; const photos:QuickUpload[]=[];
    for(const file of files) {
      if(!(file instanceof File)) throw new QuickQualityError('图片格式不正确');
      total+=file.size; if(total>32*1024*1024) throw new QuickQualityError('单次照片总大小不能超过 32 MB',413);
      if(!/\.(jpe?g|png|webp)$/i.test(file.name)) throw new QuickQualityError('请上传 JPG、PNG 或 WEBP 图片');
      const bytes=Buffer.from(await file.arrayBuffer());
      let mimeType:string, geometry:Awaited<ReturnType<typeof readQualityImageGeometry>>;
      try {mimeType=qualityFileType(file.name,file.size,bytes);geometry=await readQualityImageGeometry(bytes);}catch(e){throw new QuickQualityError(e instanceof Error?e.message:'图片无法读取');}
      const id=randomUUID(), objectKey='quality-quick/'+id;
      await putObject({key:objectKey,body:bytes,contentType:mimeType,originalName:file.name});
      staged.push(objectKey);
      photos.push({id,objectKey,displayName:file.name.slice(0,200),mimeType,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...geometry});
    }
    const result=await saveQuick(actor,input,photos); committed=result.kept;
    return NextResponse.json({ok:true,record:result.record});
  }catch(e){return quickError(e);}
  finally {if(staged.length&&!committed) await deleteObjectsBestEffort(staged);}
}
