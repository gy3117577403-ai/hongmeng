import {NextResponse} from 'next/server';
import {requireUser,unauthorized,UnauthorizedError} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(){try{await requireUser(); const categories=await prisma.resourceCategory.findMany({orderBy:{sortOrder:'asc'}}); return NextResponse.json({categories})}catch(e){if(e instanceof UnauthorizedError)return unauthorized(); return NextResponse.json({message:'分类加载失败'},{status:500})}}
