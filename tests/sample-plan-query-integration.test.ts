import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../lib/prisma';
import { listSamplePlans } from '../lib/sample-plan-query';
import { chinaDateKey } from '../lib/china-date';

test('full sample statistics, focused pagination, model search and soft deletion agree beyond 300 tasks', {skip:process.env.RUN_DB_INTEGRATION!=='1'}, async () => {
  const prefix='SCHEDULE-IT-'+randomUUID();
  const product = await prisma.drawingLibraryItem.create({data:{libraryKey:prefix,customerName:prefix,specification:prefix}});
  const today=chinaDateKey(new Date()); const day=(n:number)=>new Date(Date.parse(today)+n*86400000);
  const rows=Array.from({length:325},(_,i)=>({id:randomUUID(),code:`${prefix}-${String(i).padStart(3,'0')}`,qrCode:`${prefix}-${i}`,drawingLibraryItemId:product.id,customerNameSnapshot:prefix,specificationSnapshot:i===324?'LITERAL_100%':`MODEL-${i}`,status:i<310?'PLANNED':i<320?'COMPLETED':'CANCELLED',issuedDate:day(-1),dueDate:day(i%3-1),warningDays:2,deletedAt:i===324?new Date():null}));
  try {
    await prisma.sampleTask.createMany({data:rows});
    const q=(extra:Record<string,string>={})=>listSamplePlans(new URLSearchParams({customer:prefix,compact:'true',...extra}));
    const first=await q(); assert.equal(first.pagination.total,310); assert.equal(first.tasks.length,40); assert.equal(first.viewCounts.COMPLETED,10); assert.equal(first.viewCounts.CANCELLED,4); assert.equal(first.viewCounts.ALL,324);
    const last=await q({page:'8'}); assert.equal(last.tasks.length,30); assert.equal(last.pagination.page,8);
    const id=last.tasks[29]!.id;
    const focused=await q({focusId:id}); assert.ok(focused.tasks.some(task=>task!.id===id)); assert.equal(focused.pagination.page,8);
    const sum=first.viewCounts.TODAY+first.viewCounts.SOON+first.viewCounts.OVERDUE; assert.equal(sum,310);
    const completed=await q({view:'COMPLETED'}); assert.equal(completed.pagination.total,10);
    const cancelled=await q({view:'CANCELLED'}); assert.equal(cancelled.pagination.total,4);
    const missing=await q({assignedToMe:'true'}); assert.equal(missing.pagination.total,0);
    await prisma.sampleTask.update({where:{id:rows[309].id},data:{specificationSnapshot:'LITERAL_100%'}});
    const exact=await q({keyword:'LITERAL_100%',search:'model'}); assert.equal(exact.pagination.total,1); assert.equal(exact.tasks[0]!.id,rows[309].id);
    const range=await q({dateBy:'issued',from:today,to:today}); assert.equal(range.pagination.total,0);
    const sub=await prisma.sampleSubmission.create({data:{taskId:rows[0].id,revision:1,status:'PENDING',mutationId:randomUUID(),requestHash:prefix,snapshot:{}}});
    await prisma.sampleTask.update({where:{id:rows[0].id},data:{status:'SUBMITTED',activeSubmissionId:sub.id}});
    const review=await q({view:'PENDING_REVIEW'}); assert.equal(review.pagination.total,1); assert.equal(review.viewCounts.PENDING_REVIEW,1);
    await prisma.sampleTask.update({where:{id:rows[0].id},data:{status:'COMPLETED'}});
    assert.equal((await q({view:'PENDING_REVIEW'})).pagination.total,0);
  } finally {
    await prisma.sampleTask.updateMany({where:{id:{in:rows.map(row=>row.id)}},data:{activeSubmissionId:null}});
    await prisma.sampleSubmission.deleteMany({where:{taskId:{in:rows.map(row=>row.id)}}});
    await prisma.sampleTask.deleteMany({where:{id:{in:rows.map(row=>row.id)}}});
    await prisma.drawingLibraryItem.delete({where:{id:product.id}});
  }
});
