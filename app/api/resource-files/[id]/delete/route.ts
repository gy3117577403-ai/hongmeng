import {NextRequest,NextResponse} from 'next/server';
import {requireUser,unauthorized,UnauthorizedError} from '@/lib/auth';
import {logOp} from '@/lib/logs';
import {prisma} from '@/lib/prisma';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(_req:NextRequest,{params}:{params:{id:string}}){try{const user=await requireUser(); const old=await prisma.resourceFile.findFirst({where:{id:params.id,deletedAt:null,status:'uploaded'}}); if(!old)return NextResponse.json({message:'文件不存在'},{status:404}); const f=await prisma.resourceFile.update({where:{id:params.id},data:{status:'deleted',deletedAt:new Date()}}); await logOp({userId:user.id,action:'delete',targetType:'resource_file',targetId:f.id,detail:{softDelete:true,objectKey:f.objectKey}}); return NextResponse.json({ok:true})}catch(e){if(e instanceof UnauthorizedError)return unauthorized(); console.error(e); return NextResponse.json({message:'文件删除失败'},{status:500})}}
