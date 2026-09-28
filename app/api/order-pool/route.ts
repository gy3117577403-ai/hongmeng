import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { loadOrderPool } from '@/lib/order-pool-service';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try { await requireUser(); return NextResponse.json({ok:true,...await loadOrderPool(req.nextUrl.searchParams)}); }
  catch(e) { if(e instanceof UnauthorizedError)return unauthorized(); console.error('order pool read',e);return NextResponse.json({ok:false,error:'订单池加载失败，请重试'},{status:500}); }
}
