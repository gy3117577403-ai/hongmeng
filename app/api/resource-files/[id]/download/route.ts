import {NextRequest,NextResponse} from 'next/server';
import {requireUser,unauthorized,UnauthorizedError} from '@/lib/auth';
import {logOp} from '@/lib/logs';
import {prisma} from '@/lib/prisma';
import {signedUrl} from '@/lib/s3';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:{id:string}}){try{const user=await requireUser(); const f=await prisma.resourceFile.findFirst({where:{id:params.id,deletedAt:null,status:'uploaded'}}); if(!f)return NextResponse.json({message:'文件不存在'},{status:404}); await logOp({userId:user.id,action:'download',targetType:'resource_file',targetId:f.id}); return NextResponse.redirect(await signedUrl({key:f.objectKey,filename:f.originalName,disposition:'attachment',contentType:f.mimeType}))}catch(e){if(e instanceof UnauthorizedError)return unauthorized(); console.error(e); return NextResponse.json({message:'文件下载失败'},{status:500})}}
