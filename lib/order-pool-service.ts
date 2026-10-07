import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { PoolError, poolInteger, poolQuantities, poolSort } from './order-pool-domain';
import { lockOrderPool, ensurePoolPreparation, distributePoolCoverage } from './order-pool-material';
import { chinaDate, chinaWeekRange, parseProductionPlanOrderInput, resolveOrCreatePlanningProduct } from './production-planning';
import { fixtureSignaturesValid } from './quality-fixture-domain';
import { assertPackageFiles } from './quality-fixture-service';
import { matchPoolDrawing, PoolDrawingError } from './order-pool-drawings';
import { DrawingLibraryResolutionError } from './drawing-library-resolution';

const include = Prisma.validator<Prisma.ProductionPlanOrderInclude>()({
  batches: { where: { deletedAt: null }, select: { id: true, quantity: true, poolPreparedQuantity: true, scheduleState: true, weekStartDate: true } },
  poolMaterialTask: { include: { exceptionCases: { where: { status: 'OPEN' }, select: { id: true, materialModel: true, shortageQuantity: true, unit: true, supplySource: true, expectedArrivalAt: true } }, activities: { orderBy: { createdAt: 'desc' }, take: 1, include: { actor: { select: { displayName: true, username: true } } } } } },
  drawingLibraryItem: { include: { files: { where: { deletedAt: null, isCurrent: true, category: { code: { in: ['drawing','sop'] } } }, select: { id: true, category: { select: { code: true } } } },
    fixturePackages: { orderBy: { sequence: 'desc' }, take: 1 }, productTimeProfiles: { where: { status: 'published' }, orderBy: { version: 'desc' }, take: 1, select: { entries: { select: { unitMilliseconds: true } } } } } },
});
type Row = Prisma.ProductionPlanOrderGetPayload<{ include: typeof include }>;
const revision = (r: { updatedAt: Date; preparationVersion: number }) => `${r.updatedAt.toISOString()}:${r.preparationVersion}`;
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const str = (v: unknown, n = 500) => String(v ?? '').trim().slice(0,n);
export async function loadOrderPool(p: URLSearchParams, db = prisma) {
  const records = poolSort(await db.productionPlanOrder.findMany({ where: { deletedAt: null, status: { notIn: ['cancelled','completed'] }, poolMaterialTask: { isNot: null } }, include }));
  const review = new Map<string, boolean>();
  // Validate canonical evidence once per product, not once for each order of that product.
  for (const order of records) {
    const lib = order.drawingLibraryItem;
    if (!lib || review.has(lib.id)) continue;
    const pkg = lib.fixturePackages[0]; let valid = !!pkg && pkg.status === 'APPROVED' && fixtureSignaturesValid(pkg) && !lib.needsConfirmation && !lib.deletedAt;
    if (valid) {
      try { await assertPackageFiles(db, pkg); } catch { valid = false; }
      const evidence = [...(Array.isArray(pkg.drawingFiles) ? pkg.drawingFiles : []), ...(Array.isArray(pkg.sopFiles) ? pkg.sopFiles : [])] as { id?: string }[];
      if (lib.files.some(f => !evidence.some(e => e?.id === f.id))) valid = false;
    }
    review.set(lib.id, valid);
  }
  const all = records.filter(o=>o.orderQuantity>o.batches.reduce((n,b)=>n+b.quantity,0)||p.get('includeScheduled')==='1').map((order, i) => serializePool(order, i + 1, !!review.get(order.drawingLibraryItemId || '')));
  const queueToken = hash(records.map(o => [o.id, o.priority, o.preparationRank, revision(o)]));
  const q = str(p.get('q'),160).toLocaleLowerCase(), customer = p.get('customer') || '', importIds = new Set((p.get('ids') || '').split(',').filter(Boolean));
  const filtered = all.filter(o => (!q || [o.customerName,o.productName,o.specification,o.sourceOrderNo,o.note,o.progress].join(' ').toLocaleLowerCase().includes(q)) && (!customer || o.customerName === customer) && (!importIds.size || importIds.has(o.id)));
  const match = (o: OrderPoolDTO, filter: string) => filter === 'documents' ? !o.documentsReady : filter === 'materials' ? o.readyRemaining < o.targetRemaining || o.openCount > 0 : filter === 'ready' ? o.ready : filter === 'clarify' ? o.preparationState === 'clarify' : true;
  const counts = Object.fromEntries(['all','documents','materials','ready','clarify'].map(k => [k, filtered.filter(o => match(o,k)).length]));
  let shown = filtered.filter(o => match(o,p.get('filter') || 'all'));
  if (p.get('sort') === 'due') shown = [...shown].sort((a,b) => (a.customerDueDate || '9999').localeCompare(b.customerDueDate || '9999') || a.rank - b.rank);
  const total = shown.length, pageSize = 30, pages = Math.max(1, Math.ceil(total/pageSize)), page = Math.min(pages, Math.max(1, Math.floor(Number(p.get('page')) || 1)));
  const totals = { remaining: shown.reduce((n,o)=>n+o.remaining,0), milliseconds: shown.reduce((n,o)=>n+(o.unitMilliseconds||0)*o.remaining,0), missingTime: shown.filter(o=>!o.unitMilliseconds).length };
  return { orders: shown.slice((page-1)*pageSize,page*pageSize), counts, totals, total, allTotal: all.length, page, pages, pageSize, queueToken,
    customers: [...new Set(all.map(o => o.customerName))].sort(), currentWeek: chinaDate(chinaWeekRange(new Date()).start) };
}
function serializePool(order: Row, rank: number, documentsReady: boolean) {
  const task = order.poolMaterialTask;
  const qty = poolQuantities(order.orderQuantity, order.preparationQuantity, task?.preparedQuantity || 0, order.batches);
  const files = order.drawingLibraryItem?.files || [];
  const unitMilliseconds = order.planningUnitMilliseconds || order.drawingLibraryItem?.productTimeProfiles[0]?.entries.reduce((n,e) => n+e.unitMilliseconds,0) || null;
  const latest = task?.activities[0];
  return { id: order.id, version: revision(order), rank, priority: order.priority, sourceOrderNo: order.sourceOrderNo, sourceLineNo: order.sourceLineNo,
    customerName: order.customerName, productName: order.productName, specification: order.specification, drawingLibraryItemId: order.drawingLibraryItemId,
    orderQuantity: order.orderQuantity, orderDate: chinaDate(order.orderDate), customerDueDate: order.customerDueDateConfirmed ? chinaDate(order.customerDueDate) : '', ...qty,
    preparationDueAt: order.preparationDueAt ? chinaDate(order.preparationDueAt) : '', preparationState: order.preparationState, note: order.preparationNote || order.remark || '',
    warehouseTaskId: task?.id || null, warehouseVersion: task?.version || 0, preparedQuantity: task?.preparedQuantity || 0, openCount: task?.exceptionCases.length || 0,
    shortages: (task?.exceptionCases || []).map(e => ({ ...e, expectedArrivalAt: e.expectedArrivalAt?.toISOString() || null })),
    documentsReady, drawingCount: files.filter(f => f.category.code === 'drawing').length, sopCount: files.filter(f => f.category.code === 'sop').length,
    planningUnitMilliseconds:order.planningUnitMilliseconds, unitMilliseconds, ready: documentsReady && !!unitMilliseconds && qty.targetRemaining > 0 && qty.readyRemaining >= qty.targetRemaining && !task?.exceptionCases.length && order.preparationState !== 'clarify',
    progress: latest?.content || '', progressAt: latest?.createdAt.toISOString() || '', progressBy: latest?.actor?.displayName || latest?.actor?.username || '',
    batches: order.batches.map(b => ({ id:b.id, quantity:b.quantity, week:chinaDate(b.weekStartDate), state:b.scheduleState })),
  };
}
export type OrderPoolDTO = ReturnType<typeof serializePool>;
export type PoolInputRow = { [key: string]: unknown };
export function normalizePoolRow(row: PoolInputRow, stableNo?: string) {
  if(!row || typeof row!=='object' || Array.isArray(row))throw new PoolError('订单内容无效');
  const orderDate = str(row.orderDate) || chinaDate(new Date());
  const due = str(row.customerDueDate);
  const unit = row.unitMinutes == null || row.unitMinutes === '' ? null : Number(row.unitMinutes);
  if (unit !== null && (!Number.isFinite(unit) || unit <= 0 || unit > 1440)) throw new PoolError('单套工时须大于 0 且不超过 1440 分钟');
  const parsed = parseProductionPlanOrderInput({ ...row, productName: str(row.productName) || str(row.specification),
    sourceOrderNo: str(row.sourceOrderNo,120) || stableNo || `POOL-${randomUUID()}`, sourceLineNo: poolInteger(row.sourceLineNo || 1,'订单行号',1),
    orderDate, customerDueDate: due || orderDate, planningUnitMilliseconds: unit === null ? null : Math.round(unit*60000) });
  if (!parsed.ok) throw new PoolError(parsed.error);
  const target = row.preparationQuantity === '' || row.preparationQuantity == null ? parsed.data.orderQuantity : poolInteger(row.preparationQuantity,'准备数量');
  if (target > parsed.data.orderQuantity) throw new PoolError('准备数量不能超过订单数量');
  const duePrep = str(row.preparationDueAt); const datePrep = duePrep ? new Date(duePrep+'T00:00:00+08:00') : null;
  if (datePrep && (Number.isNaN(datePrep.getTime()) || chinaDate(datePrep) !== duePrep)) throw new PoolError('准备完成日期无效');
  return { ...parsed.data, status:'pending' as const, customerDueDateConfirmed: !!due, preparationQuantity: target, preparationDueAt: datePrep, preparationNote:str(row.note || row.remark)||null };
}
export async function previewPoolRows(rows: PoolInputRow[], fingerprint: string) {
  if (!rows.length || rows.length > 1000) throw new PoolError('请导入 1–1000 行订单');
  const seen = new Set<string>();
  return Promise.all(rows.map(async (raw,index) => {
    const input = { ...raw, sourceOrderNo: str(raw.sourceOrderNo,120) || `POOL-${fingerprint.slice(0,20)}-${index+1}` };
    try {
      const row = normalizePoolRow(input), identity = JSON.stringify([row.sourceOrderNo,row.sourceLineNo]);
      if (seen.has(identity)) throw new PoolError('文件中订单号与行号重复'); seen.add(identity);
      const existing = await prisma.productionPlanOrder.findUnique({ where: { sourceOrderNo_sourceLineNo: { sourceOrderNo: row.sourceOrderNo, sourceLineNo: row.sourceLineNo } } });
      if (existing?.deletedAt || existing && ['cancelled','completed'].includes(existing.status)) throw new PoolError('该订单已取消、删除或完成，请核对订单号');
      if (existing && (existing.customerName !== row.customerName || existing.specification !== row.specification)) throw new PoolError('同一订单行的客户或规格不一致，请核对，不能覆盖为其他产品');
      const same = existing && existing.orderQuantity === row.orderQuantity && existing.planningUnitMilliseconds === row.planningUnitMilliseconds && existing.customerDueDateConfirmed === row.customerDueDateConfirmed && (!row.customerDueDateConfirmed || chinaDate(existing.customerDueDate) === chinaDate(row.customerDueDate)) && (existing.preparationQuantity ?? existing.orderQuantity) === row.preparationQuantity && (existing.preparationDueAt?.getTime() || 0) === (row.preparationDueAt?.getTime() || 0);
      const drawing = await matchPoolDrawing({ ...row, drawingLibraryItemId: existing ? existing.drawingLibraryItemId : row.drawingLibraryItemId });
      return { line:index+2, input:{ ...input, drawingLibraryItemId:existing?.drawingLibraryItemId || drawing.matchedItemId || '' }, drawing, drawingLocked:!!existing,
        action:existing ? same ? 'skip' : 'update' : 'create', id:existing?.id || '', version:existing ? revision(existing) : '', error:'' };
    } catch(e) {
      if (!(e instanceof PoolError)) throw e;
      return { line:index+2, input, action:'error', id:'', version:'', error:e.message };
    }
  }));
}
export async function poolCommand(input: { [key: string]: unknown }, actorId: string) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new PoolError('操作内容无效');
  const key = str(input.requestKey,100); if (!key) throw new PoolError('缺少操作编号');
  const digest = hash({ actorId, input });
  return prisma.$transaction(async tx => {
    await lockOrderPool(tx);
    const replay = await tx.orderPoolCommand.findUnique({ where: { key } });
    if (replay) { if (replay.hash !== digest) throw new PoolError('操作编号已使用',409); return replay.result; }
    const action = str(input.action); let result: Prisma.InputJsonObject = {};
    if (action === 'create' || action === 'import') {
      const rows = action === 'create' ? [{ input: input.row as PoolInputRow, version:'', action:'create' }] : input.rows as { input: PoolInputRow; version: string; action: string }[];
      if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new PoolError('导入数据无效');
      const ids: string[] = [], errors: { line: number; error: string }[] = []; let created=0, updated=0, skipped=0;
      // Validation errors are reported in preview. Commit is atomic: never show a partial silent success.
      for (let i=0;i<rows.length;i++) {
        const entry=rows[i]; if (entry.action === 'error') { errors.push({line:i+2,error:'预览未通过的行未导入'}); continue; }
        const parsed = normalizePoolRow(entry.input, `POOL-${key.slice(0,32)}-${i+1}`);
        const existing = await tx.productionPlanOrder.findUnique({ where: { sourceOrderNo_sourceLineNo: { sourceOrderNo: parsed.sourceOrderNo, sourceLineNo: parsed.sourceLineNo } } });
        if (existing) {
          if (existing.deletedAt || ['cancelled','completed'].includes(existing.status)) throw new PoolError(`第 ${i+2} 行订单已结束，请重新预览`,409);
          if (existing.customerName !== parsed.customerName || existing.specification !== parsed.specification) throw new PoolError('订单身份冲突，请重新预览',409);
          if (action === 'create') throw new PoolError('订单号与行号已存在',409);
          if (parsed.drawingLibraryItemId && parsed.drawingLibraryItemId !== existing.drawingLibraryItemId) throw new PoolDrawingError(new DrawingLibraryResolutionError('原订单的图纸资料关联不能通过导入更换，请保留原档案', 'DRAWING_LIBRARY_ORDER_LOCKED', existing.drawingLibraryItemId ? [existing.drawingLibraryItemId] : []), i+2);
          if (entry.action === 'skip' || input.updateExisting !== true) { skipped++; ids.push(existing.id); continue; }
          if (entry.version !== revision(existing)) throw new PoolError('订单已更新，请重新预览导入文件',409);
          const batches = await tx.productionPlanBatch.aggregate({ where: { planOrderId:existing.id, deletedAt:null }, _sum:{quantity:true} });
          const task = await tx.warehouseMaterialTask.findUnique({ where: { planOrderId:existing.id } });
          if (parsed.orderQuantity < (batches._sum.quantity || 0) || parsed.preparationQuantity < (task?.preparedQuantity || 0)) throw new PoolError(`第 ${i+2} 行数量低于已排或已配套数量，请先处理已分配部分`,409);
          // Existing weekly time snapshots and confirmed delivery changes use the regular planning editor.
          if ((batches._sum.quantity || 0) && (existing.planningUnitMilliseconds !== parsed.planningUnitMilliseconds || existing.customerDueDateConfirmed !== parsed.customerDueDateConfirmed || chinaDate(existing.customerDueDate) !== chinaDate(parsed.customerDueDate))) throw new PoolError('已排订单的交期、工时请通过计划变更调整，导入不会改写已排批次',409);
          await tx.productionPlanOrder.update({ where:{id:existing.id}, data:{orderQuantity:parsed.orderQuantity, preparationQuantity:parsed.preparationQuantity, preparationDueAt:parsed.preparationDueAt, planningUnitMilliseconds:parsed.planningUnitMilliseconds, customerDueDate:parsed.customerDueDate, customerDueDateConfirmed:parsed.customerDueDateConfirmed, updatedById:actorId, preparationVersion:{increment:1}} });
          await ensurePoolPreparation(tx,existing.id,actorId); await resetPoolTargetStatus(tx,existing.id,actorId); ids.push(existing.id); updated++;
        } else {
          const product = await resolveOrCreatePlanningProduct(tx,parsed,{createIfMissing:true,restoreIfDeleted:false}).catch(error => {
            if (error instanceof DrawingLibraryResolutionError) throw new PoolDrawingError(error, action === 'import' ? i+2 : undefined);
            throw error;
          });
          if (product.status !== 'resolved' || !product.references.drawingLibraryItemId) throw new PoolError(`第 ${i+2} 行产品档案无法关联，请核对同名档案或回收站`,409);
          const order = await tx.productionPlanOrder.create({ data:{...parsed,drawingLibraryItemId:product.references.drawingLibraryItemId, createdById:actorId, updatedById:actorId} });
          await ensurePoolPreparation(tx,order.id,actorId); ids.push(order.id); created++;
        }
        await tx.productionPlanChange.create({data:{planOrderId:ids[ids.length-1],action:existing?'pool_import_update':'pool_create',actorId,afterData:{sourceOrderNo:parsed.sourceOrderNo,quantity:parsed.orderQuantity}}});
      }
      result={ids,created,updated,skipped,errors};
    } else {
      const ids = Array.isArray(input.ids) ? input.ids.map(v=>str(v,100)) : [str(input.id,100)];
      if (!ids.length || ids.length>100 || new Set(ids).size!==ids.length) throw new PoolError('请选择 1–100 项不同订单');
      const orders = await tx.productionPlanOrder.findMany({ where:{id:{in:ids},deletedAt:null,status:{notIn:['cancelled','completed']}},include:{batches:{where:{deletedAt:null},select:{quantity:true}},poolMaterialTask:true} });
      if(orders.length!==ids.length) throw new PoolError('部分订单已结束，请刷新',409);
      const versions=input.versions as { [key:string]:string } | undefined;
      for(const o of orders) if((versions?.[o.id] || input.version)!==revision(o)) throw new PoolError('订单已被更新，请刷新后再保存',409);
      if(action==='move' || action==='priority') {
          const all=poolSort(await tx.productionPlanOrder.findMany({where:{deletedAt:null,status:{notIn:['cancelled','completed']},poolMaterialTask:{isNot:null}},include:{batches:{where:{deletedAt:null},select:{quantity:true}}}}));
        if(input.queueToken!==hash(all.map(o=>[o.id,o.priority,o.preparationRank,revision(o)]))) throw new PoolError('准备顺序已更新，请刷新后重新排序',409);
        if(action==='priority') {
          if(!['normal','urgent','insert'].includes(String(input.priority))) throw new PoolError('优先级无效');
          for(const o of orders) await tx.productionPlanOrder.update({where:{id:o.id},data:{priority:String(input.priority),preparationVersion:{increment:1},updatedById:actorId}});
        } else {
          const moving=orders[0]; if(orders.length!==1) throw new PoolError('每次移动一项订单');
          const group=all.filter(o=>o.priority===moving.priority && o.orderQuantity>o.batches.reduce((n,b)=>n+b.quantity,0)), from=group.findIndex(o=>o.id===moving.id);
          if(from<0)throw new PoolError('该订单已全部排产，请刷新',409);
          const desired=poolInteger(input.position,'组内顺序',1)-1;
          if(desired>=group.length) throw new PoolError(`同优先级共有 ${group.length} 项`);
          const [item]=group.splice(from,1);group.splice(desired,0,item);
          for(let i=0;i<group.length;i++) await tx.productionPlanOrder.update({where:{id:group[i].id},data:{preparationRank:i+1,preparationVersion:{increment:1},updatedById:actorId}});
        }
      } else if(action==='edit') {
        const o=orders[0], allocated=o.batches.reduce((n,b)=>n+b.quantity,0), quantity=poolInteger(input.orderQuantity,'订单数量',1), target=poolInteger(input.preparationQuantity,'准备数量');
        if(quantity<allocated || quantity<(o.poolMaterialTask?.preparedQuantity || 0)) throw new PoolError('订单数量不能低于已排或已确认配套数量；需先核对对应记录',409);
        if(target>quantity || target<(o.poolMaterialTask?.preparedQuantity || 0)) throw new PoolError('准备数量须介于已确认配套数量与订单数量之间');
        const due=str(input.preparationDueAt), d=due?new Date(due+'T00:00:00+08:00'):null;
        if(d && (Number.isNaN(d.getTime()) || chinaDate(d)!==due)) throw new PoolError('准备完成日期无效');
        const customerDue=str(input.customerDueDate),unit=input.unitMinutes===''||input.unitMinutes==null?null:Number(input.unitMinutes);
        if(unit!==null&&(!Number.isFinite(unit)||unit<=0||unit>1440))throw new PoolError('单套工时须大于 0 且不超过 1440 分钟');
        const customerDate=customerDue?new Date(customerDue+'T00:00:00+08:00'):o.orderDate;
        if(Number.isNaN(customerDate.getTime()) || customerDue && chinaDate(customerDate)!==customerDue)throw new PoolError('客户交期无效');
        const unitMs=unit===null?null:Math.round(unit*60000);
        if(allocated && (unitMs!==o.planningUnitMilliseconds || customerDue!==(o.customerDueDateConfirmed?chinaDate(o.customerDueDate):'')))throw new PoolError('订单已有排产批次，工时和客户交期请在周计划中维护',409);
        await tx.productionPlanOrder.update({where:{id:o.id},data:{orderQuantity:quantity,preparationQuantity:target,preparationDueAt:d,preparationNote:str(input.note)||null,preparationState:input.preparationState==='clarify'?'clarify':'open',...(!allocated?{planningUnitMilliseconds:unitMs,customerDueDate:customerDate,customerDueDateConfirmed:!!customerDue}:{}),preparationVersion:{increment:1},updatedById:actorId}});
        await resetPoolTargetStatus(tx,o.id,actorId);
      } else if(action==='cancel') {
        if(orders.some(o=>o.batches.length)) throw new PoolError('已有周计划的订单请通过计划变更处理，避免取消执行中的批次',409);
        if(!str(input.note)) throw new PoolError('请填写取消原因');
        for(const o of orders) await tx.productionPlanOrder.update({where:{id:o.id},data:{status:'cancelled',preparationNote:str(input.note),preparationVersion:{increment:1},updatedById:actorId}});
      } else throw new PoolError('不支持的操作');
      for(const o of orders) await tx.productionPlanChange.create({data:{planOrderId:o.id,action:`pool_${action}`,actorId,reason:str(input.note)||null,afterData:{priority:str(input.priority),position:Number(input.position)||null}}});
      result={ids};
    }
    await tx.orderPoolCommand.create({data:{key,hash:digest,result}});
    return result;
  },{maxWait:10000,timeout:60000});
}
export async function resetPoolTargetStatus(tx: Prisma.TransactionClient,id:string,actorId:string) {
  const o=await tx.productionPlanOrder.findUniqueOrThrow({where:{id},include:{poolMaterialTask:{include:{exceptionCases:{where:{status:'OPEN'}}}}}});
  const t=o.poolMaterialTask;if(!t)return;
  const full=(o.preparationQuantity??o.orderQuantity)>0 && t.preparedQuantity >= (o.preparationQuantity??o.orderQuantity) && !t.exceptionCases.length;
  await tx.warehouseMaterialTask.update({where:{id:t.id},data:{status:full?'completed':t.exceptionCases.length?'exception':'pending',requirementsConfirmed:full,completedAt:full?t.completedAt:null,completedById:full?t.completedById:null,version:{increment:1},updatedById:actorId}});
  await distributePoolCoverage(tx,id,actorId);
}
