import {NextRequest,NextResponse} from 'next/server';
import {requireUser,unauthorized,UnauthorizedError} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(req:NextRequest){try{await requireUser(); const k=req.nextUrl.searchParams.get('keyword')?.trim(); const workOrders=await prisma.workOrder.findMany({where:k?{OR:[{code:{contains:k,mode:'insensitive'}},{productName:{contains:k,mode:'insensitive'}}]}:undefined,orderBy:[{createdAt:'desc'},{code:'asc'}]}); return NextResponse.json({workOrders:workOrders.map(o=>({...o,createdAt:o.createdAt.toISOString(),updatedAt:o.updatedAt.toISOString()}))})}catch(e){if(e instanceof UnauthorizedError)return unauthorized(); console.error(e); return NextResponse.json({message:'工单加载失败'},{status:500})}}
