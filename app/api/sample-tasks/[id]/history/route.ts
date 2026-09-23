import { NextRequest,NextResponse } from 'next/server';
import { requireUser,UnauthorizedError,unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:{id:string}}) {
  try {
    await requireUser();
    const task=await prisma.sampleTask.findFirst({where:{id:params.id,deletedAt:null},select:{id:true,importFileName:true,importSourceRow:true,importMutationId:true,createdAt:true,createdByName:true}});
    if(!task)return NextResponse.json({ok:false,error:'计划不存在'},{status:404});
    const logs=await prisma.operationLog.findMany({where:{targetType:'sample_task',targetId:params.id},orderBy:{createdAt:'desc'},take:100,select:{id:true,action:true,detail:true,createdAt:true}});
    return NextResponse.json({ok:true,source:task,logs});
  } catch(e) {if(e instanceof UnauthorizedError)return unauthorized();throw e;}
}
