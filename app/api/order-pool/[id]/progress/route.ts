import { NextRequest,NextResponse } from 'next/server';
import { requireUser,UnauthorizedError,unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PoolError } from '@/lib/order-pool-domain';
import { lockOrderPool } from '@/lib/order-pool-material';
import { createHash } from 'node:crypto';
export const dynamic='force-dynamic';
export async function POST(req:NextRequest,{params}:{params:{id:string}}){
  try{const user=await requireUser(),body=await req.json(),note=String(body.note||'').trim().slice(0,600);if(!note)throw new PoolError('请填写进展');
    const key=String(body.requestKey||'').trim().slice(0,100);if(!key)throw new PoolError('缺少操作编号');
    const hash=createHash('sha256').update(JSON.stringify({actor:user.id,id:params.id,note,clarify:body.clarify===true})).digest('hex');
    await prisma.$transaction(async tx=>{await lockOrderPool(tx);
      const replay=await tx.orderPoolCommand.findUnique({where:{key}});if(replay){if(replay.hash!==hash)throw new PoolError('操作编号已使用',409);return;}
      const order=await tx.productionPlanOrder.findUnique({where:{id:params.id},include:{poolMaterialTask:true}});if(!order||order.deletedAt||['cancelled','completed'].includes(order.status)||!order.poolMaterialTask)throw new PoolError('订单已结束或不存在',409);
      await tx.warehouseMaterialActivity.create({data:{taskId:order.poolMaterialTask.id,action:'pool_progress',actorId:user.id,content:note}});
      await tx.productionPlanOrder.update({where:{id:order.id},data:{preparationState:body.clarify===true?'clarify':order.preparationState,preparationNote:body.clarify===true?note:order.preparationNote,preparationVersion:{increment:1},updatedById:user.id}});
      await tx.orderPoolCommand.create({data:{key,hash,result:{ok:true}}});
    });return NextResponse.json({ok:true});
  }catch(e){if(e instanceof UnauthorizedError)return unauthorized();return NextResponse.json({ok:false,error:e instanceof Error?e.message:'保存失败'},{status:e instanceof PoolError?e.status:500});}
}
