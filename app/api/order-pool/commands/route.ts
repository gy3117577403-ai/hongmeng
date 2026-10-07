import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { poolCommand } from '@/lib/order-pool-service';
import { PoolError } from '@/lib/order-pool-domain';
import { DrawingLibraryResolutionError } from '@/lib/drawing-library-resolution';
import { PoolDrawingError } from '@/lib/order-pool-drawings';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try { const user=await requireUser(); const body=await req.json(); return NextResponse.json({ok:true,...await poolCommand(body,user.id) as object}); }
  catch(e) { if(e instanceof UnauthorizedError)return unauthorized(); if(e instanceof PoolError)return NextResponse.json({ok:false,error:e.message},{status:e.status}); if(e instanceof DrawingLibraryResolutionError)return NextResponse.json({ok:false,error:e.message,code:e.code,itemIds:e.itemIds,line:e instanceof PoolDrawingError?e.line:undefined},{status:409}); console.error('order pool command',e);return NextResponse.json({ok:false,error:'保存失败，请刷新后重试；订单未部分保存'},{status:500}); }
}
