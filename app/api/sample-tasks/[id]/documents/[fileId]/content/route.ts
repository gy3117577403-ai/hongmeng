import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { ForbiddenError, UnauthorizedError, forbidden, requireUser, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { currentSampleDocuments } from '@/lib/sample-documents';
import { getObjectStream } from '@/lib/s3';
import { parseHttpByteRange } from '@/lib/http-byte-range';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: { id: string; fileId: string } }) {
  try {
    await requireUser();
    const task = await prisma.sampleTask.findFirst({where:{id:params.id,deletedAt:null}});
    if (!task) return NextResponse.json({ok:false,error:'样品订单不存在'},{status:404});
    const current = await currentSampleDocuments(prisma,task);
    const referenced = current.some(f=>f.id===params.fileId) || !!await prisma.operationLog.findFirst({where:{action:'sample_document_changed',targetId:task.id,OR:[{detail:{path:['old','id'],equals:params.fileId}},{detail:{path:['next','id'],equals:params.fileId}}]},select:{id:true}});
    // Historical evidence stays readable after the archive version has been retired.
    const file = referenced ? await prisma.drawingLibraryFile.findFirst({where:{id:params.fileId,libraryItemId:task.drawingLibraryItemId}}) : null;
    if (!file) return NextResponse.json({ok:false,error:'文件未关联此订单'},{status:404});
    const range = parseHttpByteRange(req.headers.get('range'),file.size);
    if (range==='invalid') return new Response(null,{status:416,headers:{'Content-Range':`bytes */${file.size}`}});
    const stream = await getObjectStream(file.objectKey,{range:range?`bytes=${range.start}-${range.end}`:undefined,abortSignal:req.signal});
    const name = (file.displayName || file.originalName).replace(/[\r\n]/g,'');
    return new NextResponse(Readable.toWeb(stream as Readable) as BodyInit,{status:range?206:200,headers:{
      'Content-Type':file.mimeType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes',
      'Content-Length':String(range?.length || file.size),...(range?{'Content-Range':`bytes ${range.start}-${range.end}/${file.size}`}:{})
    }});
  } catch(error) {
    if(error instanceof UnauthorizedError) return unauthorized(error);
    if(error instanceof ForbiddenError) return forbidden();
    console.error('sample document content failed',{taskId:params.id,fileId:params.fileId,error});
    return NextResponse.json({ok:false,error:'图纸读取失败，请重试'},{status:500});
  }
}
