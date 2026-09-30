import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { employeePolicyOnDate } from '@/lib/employee-attainment-policy-service';
import { terminalToolingTerminalKey, terminalToolingContextKey, terminalToolingBladeInclude, serializeTerminalToolingBlade } from '@/lib/terminal-tooling';
import { TOOLING_POSITIONS, TOOLING_MODES, type ToolingMode, type ToolingPosition, segmentDays, segmentTotals, shanghaiDay, worklogRange, stockSummary } from '@/lib/tooling-worklog-domain';

type Tx = Prisma.TransactionClient;
export type ToolingActor = { id: string; employeeId: string | null; username: string; displayName?: string | null; laborRole?: string };
export class ToolingError extends Error { constructor(message: string, public status = 400) { super(message); } }
const name = (a: ToolingActor) => a.displayName || a.username;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const text = (value: unknown, max = 500) => { if (value == null) return ''; if (typeof value !== 'string' || value.length > max) throw new ToolingError('文字内容过长或格式不正确'); return value.trim(); };
const box = (value: unknown) => { if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100) throw new ToolingError('盒子编号为 1–100'); return Number(value); };
const pos = (value: unknown): ToolingPosition => { if (!TOOLING_POSITIONS.includes(value as ToolingPosition)) throw new ToolingError('请选择刀位'); return value as ToolingPosition; };
async function lock(tx: Tx, key: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`; }
export const toolingJobInclude = { moldUsage: true, segments: { orderBy: { startedAt: 'asc' as const } }, usages: { orderBy: { startedAt: 'asc' as const } }, events: { orderBy: { createdAt: 'desc' as const }, take: 80 }, ledger: { select: { id: true, workDate: true, requestedMinutes: true, reportedMilliseconds: true, status: true } } } satisfies Prisma.ToolingJobInclude;
type Job = Prisma.ToolingJobGetPayload<{ include: typeof toolingJobInclude }>;
const serialize = (job: Job, now = new Date()) => ({ ...job, ...segmentTotals(job.segments, now) });
const event = (tx: Tx, a: ToolingActor, action: string, detail: unknown, jobId?: string) => tx.toolingEvent.create({ data: { actorId: a.id, actorName: name(a), action, detail: json(detail), jobId } });

/** All commands are replayable; stock allocation and work facts commit together. */
async function command(a: ToolingActor, data: Record<string, unknown>, perform: (tx: Tx) => Promise<Record<string, unknown>>) {
  const key = text(data.key, 100); if (key.length < 8) throw new ToolingError('缺少操作标识，请刷新后重试');
  const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(async tx => {
      await lock(tx, 'tooling:receipt:' + a.id + ':' + key);
      const receipt = await tx.toolingReceipt.findUnique({ where: { actorId_key: { actorId: a.id, key } } });
      if (receipt) { if (receipt.hash !== hash) throw new ToolingError('相同操作标识对应不同内容，请重新操作', 409); return receipt.result as Record<string, unknown>; }
      // A short, shared inventory lock protects mixed kits, moves and simultaneous allocation.
      await lock(tx, 'tooling:inventory');
      const result = await perform(tx);
      await tx.toolingReceipt.create({ data: { actorId: a.id, key, hash, result: json(result) } });
      return result;
    }, { isolationLevel: 'ReadCommitted', timeout: 20000, maxWait: 15000 }); }
    catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(e.code) && attempt < 2) continue; throw e; }
  }
}

export async function getToolingInventory() {
  const blades = await prisma.terminalToolingBlade.findMany({ include: { ...terminalToolingBladeInclude, stockUnits: { include: { kit: { select: { code: true } }, inUseJob: { select: { actorName: true, status: true, contextSnapshot: true, employeeId: true } } }, orderBy: [{ homeBox: 'asc' }, { createdAt: 'asc' }] } }, orderBy: { model: 'asc' } });
  return blades.map(b => ({ ...serializeTerminalToolingBlade(b), countedAt: b.inventoryCountedAt, units: b.stockUnits, stock: { ...stockSummary(b.stockUnits), registered: b.inventoryCountedAt !== null } }));
}
export async function getToolingMolds() {
  return prisma.toolingMold.findMany({ include: { inUseJob: { select: { actorName: true, status: true, employeeId: true } } }, orderBy: { model: 'asc' } });
}
const moldPosition = (value: unknown) => { if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 20) throw new ToolingError('专模位置编号为 1–20'); return Number(value); };
async function moldInventoryCommand(tx: Tx, a: ToolingActor, data: Record<string, unknown>) {
  const action = text(data.action), reason = text(data.reason);
  if (action === 'MOLD_CREATE') {
    const model = text(data.model, 100), homePosition = moldPosition(data.position);
    if (!model) throw new ToolingError('请填写专模型号');
    const normalizedKey = model.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    if (await tx.toolingMold.findUnique({ where: { normalizedKey } })) throw new ToolingError('此专模型号已建档；每型号一套，请搜索已有记录', 409);
    const mold = await tx.toolingMold.create({ data: { model, normalizedKey, manufacturer: text(data.manufacturer, 100), note: text(data.note), homePosition, currentPosition: homePosition } });
    await event(tx, a, action, { moldId: mold.id, model, position: homePosition });
    return { moldId: mold.id };
  }
  const mold = await tx.toolingMold.findUnique({ where: { id: text(data.moldId) }, include: { inUseJob: true } });
  if (!mold) throw new ToolingError('专模不存在', 404);
  if (mold.version !== data.version) throw new ToolingError('专模状态已变化，请刷新后操作', 409);
  if (!['MOLD_EDIT','MOLD_MOVE','MOLD_RETURN','MOLD_MAINTENANCE','MOLD_RETIRE'].includes(action)) throw new ToolingError('操作不支持');
  if (mold.state === 'RETIRED') throw new ToolingError('此专模已停用');
  if (mold.inUseJob && ['RUNNING','PAUSED'].includes(mold.inUseJob.status)) throw new ToolingError('专模正在调模，请先结束作业', 409);
  if (action === 'MOLD_EDIT') {
    await tx.toolingMold.update({ where: { id: mold.id }, data: { manufacturer: text(data.manufacturer, 100), note: text(data.note), version: { increment: 1 } } });
  } else {
    if (action === 'MOLD_MOVE' && mold.state !== 'AVAILABLE') throw new ToolingError('只能移动可用专模');
    if (['MOLD_MAINTENANCE','MOLD_RETIRE'].includes(action) && !reason) throw new ToolingError('请填写处理原因');
    if (action === 'MOLD_RETURN' && mold.inUseJob?.toolingMode === 'COMBINATION') {
      if (data.restored !== true) throw new ToolingError('请确认专模已恢复原配刀片');
      if (await tx.toolingUsage.count({ where: { jobId: mold.inUseJob.id, disposition: 'DEVICE' } })) throw new ToolingError('还有外借刀片留在设备，请先在刀片库归还');
    }
    const position = ['MOLD_MOVE','MOLD_RETURN'].includes(action) ? moldPosition(data.position) : null;
    const state = action === 'MOLD_MAINTENANCE' ? 'MAINTENANCE' : action === 'MOLD_RETIRE' ? 'RETIRED' : 'AVAILABLE';
    await tx.toolingMold.update({ where: { id: mold.id }, data: { state, currentPosition: position, ...(action === 'MOLD_MOVE' ? { homePosition: position! } : {}), inUseJobId: state === 'AVAILABLE' ? null : mold.inUseJobId, version: { increment: 1 } } });
    if (action === 'MOLD_RETURN' && mold.inUseJobId) await tx.toolingMoldUsage.updateMany({ where: { moldId: mold.id, jobId: mold.inUseJobId }, data: { disposition: 'RETURNED', endedAt: new Date() } });
  }
  await event(tx, a, action, { moldId: mold.id, before: mold, position: data.position, reason, restored: data.restored });
  return { moldId: mold.id };
}
async function releaseMold(tx: Tx, a: ToolingActor, job: Job, data: Record<string, unknown>, now: Date) {
  const usage = job.moldUsage!;
  const mold = await tx.toolingMold.findUniqueOrThrow({ where: { id: usage.moldId } });
  if (mold.inUseJobId !== job.id || usage.disposition === 'HISTORICAL') throw new ToolingError('专模使用状态已变化', 409);
  const disposition = text(data.moldDisposition);
  if (!['HOME','BOX','DEVICE','MAINTENANCE'].includes(disposition)) throw new ToolingError('请确认专模去向');
  const combined = job.toolingMode === 'COMBINATION';
  const restored = !combined || data.moldRestored === true;
  if (combined && disposition !== 'DEVICE' && await tx.toolingUsage.count({ where: { jobId: job.id, disposition: 'DEVICE' } })) throw new ToolingError('外借刀片仍在设备上，请一同归还或保留专模在设备上');
  if (combined && disposition === 'DEVICE' && data.moldRestored === true) throw new ToolingError('组合仍留在设备时，请取消恢复原配确认');
  const position = disposition === 'BOX' ? moldPosition(data.moldPosition) : disposition === 'HOME' ? mold.homePosition : null;
  const state = disposition === 'DEVICE' ? 'IN_USE' : disposition === 'MAINTENANCE' ? 'MAINTENANCE' : restored ? 'AVAILABLE' : 'RESTORE';
  await tx.toolingMold.update({ where: { id: mold.id }, data: { state, currentPosition: position, inUseJobId: state === 'AVAILABLE' ? null : job.id, version: { increment: 1 } } });
  await tx.toolingMoldUsage.update({ where: { id: usage.id }, data: { disposition: state === 'RESTORE' ? 'RESTORE' : disposition, endedAt: now } });
  await event(tx, a, 'MOLD_RELEASE', { moldId: mold.id, disposition, state, restored, position }, job.id);
}
export async function getToolingInventoryHistory(moldId?: string, bladeId?: string) {
  if (!moldId && !bladeId) return [];
  return prisma.toolingEvent.findMany({ where: moldId ? { OR: [{ detail: { path: ['moldId'], equals: moldId } }, { job: { moldUsage: { moldId } } }] } : { OR: [{ detail: { path: ['bladeId'], equals: bladeId } }, { detail: { path: ['before'], array_contains: [{ bladeId }] } }, { job: { usages: { some: { bladeId } } } }] }, orderBy: { createdAt: 'desc' }, take: 40 });
}
export async function inventoryCommand(a: ToolingActor, data: Record<string, unknown>) {
  return command(a, data, async tx => {
    const action = text(data.action), reason = text(data.reason);
    if (action.startsWith('MOLD_')) return moldInventoryCommand(tx, a, data);
    if (action === 'REGISTER' || action === 'ADD') {
      const bladeId = text(data.bladeId), blade = await tx.terminalToolingBlade.findUnique({ where: { id: bladeId } });
      if (!blade?.isActive) throw new ToolingError('刀片型号不存在或已停用');
      if (action === 'REGISTER' && blade.inventoryCountedAt) throw new ToolingError('此型号已盘点，请使用补充库存', 409);
      const quantity = Number(data.quantity), homeBox = box(data.box);
      if (!Number.isInteger(quantity) || quantity < (action === 'REGISTER' ? 0 : 1) || quantity > 100) throw new ToolingError('数量须为整数，单次最多 100');
      if (!['KIT', 'LOOSE'].includes(String(data.kind))) throw new ToolingError('请选择整套或散刀');
      const positions = data.kind === 'KIT' ? TOOLING_POSITIONS : [pos(data.position)];
      if (positions.some(p => !blade.compatiblePositions.includes(p))) throw new ToolingError('所选刀位不属于此型号，请先完善型号资料');
      for (let n = 0; n < quantity; n++) {
        const kit = data.kind === 'KIT' ? await tx.toolingKit.create({ data: { code: 'K-' + randomUUID().slice(0, 8).toUpperCase() } }) : null;
        await tx.toolingStock.createMany({ data: positions.map(position => ({ bladeId, position, homeBox, currentBox: homeBox, kitId: kit?.id })) });
      }
      await tx.terminalToolingBlade.update({ where: { id: bladeId }, data: { inventoryCountedAt: new Date() } });
      await event(tx, a, action, { bladeId, model: blade.model, quantity, kind: data.kind, positions, box: homeBox, reason });
      return { bladeId };
    }
    const selections = Array.isArray(data.units) ? data.units as Array<{ id: string; version: number }> : [];
    if (!selections.length || selections.length > 400 || new Set(selections.map(s => s.id)).size !== selections.length) throw new ToolingError('请选择库存实物');
    const units = await tx.toolingStock.findMany({ where: { id: { in: selections.map(s => s.id) } }, include: { inUseJob: true } });
    if (units.length !== selections.length || units.some(u => selections.find(s => s.id === u.id)?.version !== u.version)) throw new ToolingError('库存已变化，请刷新后重新操作', 409);
    if (['ASSEMBLE', 'DISASSEMBLE'].includes(action)) {
      if (units.some(u => u.state !== 'AVAILABLE')) throw new ToolingError('只能对在库刀片组套或拆套');
      if (action === 'ASSEMBLE') {
        if (units.length !== 4 || units.some(u => u.kitId) || !TOOLING_POSITIONS.every(p => units.some(u => u.position === p)) || new Set(units.map(u => u.bladeId)).size !== 1 || new Set(units.map(u => u.currentBox)).size !== 1) throw new ToolingError('组套需要同一型号、同一盒的四个刀位散刀');
        const kit = await tx.toolingKit.create({ data: { code: 'K-' + randomUUID().slice(0, 8).toUpperCase() } });
        await tx.toolingStock.updateMany({ where: { id: { in: units.map(u => u.id) } }, data: { kitId: kit.id, version: { increment: 1 } } });
      } else {
        const kitIds = [...new Set(units.map(u => u.kitId).filter((id): id is string => !!id))];
        const all = await tx.toolingStock.findMany({ where: { kitId: { in: kitIds } } });
        if (!kitIds.length || all.some(u => u.state !== 'AVAILABLE')) throw new ToolingError('整套仍有刀片使用中或待处理，不能拆套');
        await tx.toolingStock.updateMany({ where: { kitId: { in: kitIds } }, data: { kitId: null, version: { increment: 1 } } });
      }
    } else {
      if (!['MOVE', 'RETURN', 'MAINTENANCE', 'RETIRE'].includes(action)) throw new ToolingError('操作不支持');
      if (['MAINTENANCE', 'RETIRE'].includes(action) && !reason) throw new ToolingError('请填写处理原因');
      if (units.some(u => u.state === 'IN_USE' && ['RUNNING', 'PAUSED'].includes(u.inUseJob?.status || ''))) throw new ToolingError('正在调模的刀片请在当前作业中更换或完成后归还', 409);
      if (action === 'MOVE' && units.some(u => u.state !== 'AVAILABLE')) throw new ToolingError('移盒只能选择在库刀片');
      if (units.some(u => u.state === 'RETIRED')) throw new ToolingError('已停用的实物不能再次操作，请补充库存');
      const destination = ['MOVE', 'RETURN'].includes(action) ? box(data.box) : null;
      await tx.toolingStock.updateMany({ where: { id: { in: units.map(u => u.id) } }, data: { state: action === 'MAINTENANCE' ? 'MAINTENANCE' : action === 'RETIRE' ? 'RETIRED' : 'AVAILABLE', currentBox: destination, inUseJobId: null, ...(action === 'MOVE' ? { homeBox: destination! } : {}), version: { increment: 1 } } });
      if (action === 'RETURN') await tx.toolingUsage.updateMany({ where: { stockId: { in: units.map(u => u.id) }, disposition: 'DEVICE' }, data: { disposition: 'RETURNED', endedAt: new Date() } });
    }
    await event(tx, a, action, { before: units.map(({ inUseJob: _job, ...unit }) => unit), box: data.box, reason });
    return { count: units.length };
  });
}

async function employeeFor(tx: Tx, a: ToolingActor) {
  if (!a.employeeId) throw new ToolingError('请先在人事账号管理中绑定员工，再开始计时', 403);
  await lock(tx, 'other-work:' + a.employeeId);
  const employee = await tx.employee.findUnique({ where: { id: a.employeeId } });
  if (!employee?.isActive) throw new ToolingError('员工档案未启用，请联系人事', 403);
  return employee;
}
function ownJob(a: ToolingActor, job: Job) { if (job.employeeId !== a.employeeId && a.laborRole !== 'ADMIN') throw new ToolingError('只能操作本人的作业', 403); }
async function allocate(tx: Tx, a: ToolingActor, jobId: string, raw: unknown, now: Date, historicalEnd?: Date) {
  const choices = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];
  if (choices.length > 4 || new Set(choices.map(c => c.position)).size !== choices.length) throw new ToolingError('每个刀位只能选择一把刀片');
  for (const choice of choices) {
    const position = pos(choice.position), bladeId = text(choice.bladeId), stockId = text(choice.stockId) || null;
    const blade = await tx.terminalToolingBlade.findUnique({ where: { id: bladeId }, include: { positionSpecs: true } });
    if (!blade?.isActive || !blade.compatiblePositions.includes(position)) throw new ToolingError('刀片型号或刀位已变化，请重新选择');
    const stock = stockId ? await tx.toolingStock.findUnique({ where: { id: stockId }, include: { kit: true, inUseJob: true } }) : null;
    if (stockId && (!stock || stock.bladeId !== bladeId || stock.position !== position)) throw new ToolingError('库存实物与刀位不匹配');
    if (!historicalEnd && !stockId && blade.inventoryCountedAt) throw new ToolingError(blade.model + ' 已管理库存，请选择可用实物；缺刀时可先不选该刀位');
    if (stock && !historicalEnd) {
      const reuse = choice.reuse === true && stock.state === 'IN_USE' && stock.inUseJob?.employeeId === a.employeeId && !['RUNNING', 'PAUSED'].includes(stock.inUseJob.status);
      if (stock.state !== 'AVAILABLE' && !reuse) throw new ToolingError('刀片已被使用或待处理，请重新选择', 409);
      if (reuse) await tx.toolingUsage.updateMany({ where: { stockId, disposition: 'DEVICE' }, data: { disposition: 'REUSED', endedAt: now } });
      await tx.toolingStock.update({ where: { id: stock.id }, data: { state: 'IN_USE', currentBox: null, inUseJobId: jobId, version: { increment: 1 } } });
    }
    const spec = blade.positionSpecs.find(s => s.position === position);
    await tx.toolingUsage.create({ data: { jobId, bladeId, stockId, position, startedAt: now, ...(historicalEnd ? { endedAt: historicalEnd, disposition: 'HISTORICAL' } : {}), snapshot: json({ model: blade.model, manufacturer: blade.manufacturer, specification: spec?.specification || blade.specification, dimensionA: spec?.dimensionA, dimensionB: spec?.dimensionB, homeBox: stock?.homeBox ?? null, pickedBox: stock?.currentBox ?? null, kitCode: stock?.kit?.code ?? null, inventoryUncounted: !blade.inventoryCountedAt }) } });
  }
}
async function releaseUsage(tx: Tx, usage: Job['usages'][number], raw: Record<string, unknown>, now: Date) {
  const disposition = String(raw.disposition || 'HOME');
  if (!['HOME', 'BOX', 'DEVICE', 'MAINTENANCE'].includes(disposition)) throw new ToolingError('请选择刀片去向');
  if (usage.stockId && disposition !== 'DEVICE') {
    const stock = await tx.toolingStock.findUniqueOrThrow({ where: { id: usage.stockId } });
    const currentBox = disposition === 'BOX' ? box(raw.box) : disposition === 'HOME' ? stock.homeBox : null;
    await tx.toolingStock.update({ where: { id: stock.id }, data: { currentBox, state: disposition === 'MAINTENANCE' ? 'MAINTENANCE' : 'AVAILABLE', inUseJobId: null, version: { increment: 1 } } });
  }
  await tx.toolingUsage.update({ where: { id: usage.id }, data: { disposition, endedAt: now } });
}

/** Exactly one shared-hours fact per job/day; corrections void the old fact instead of duplicating it. */
async function syncLedger(tx: Tx, a: ToolingActor, job: Job, now: Date) {
  await lock(tx, 'other-work:' + job.employeeId);
  const employee = await tx.employee.findUniqueOrThrow({ where: { id: job.employeeId } });
  const old = await tx.otherWorkTimeRequest.findMany({ where: { toolingJobId: job.id, status: { not: 'VOIDED' } } });
  await tx.otherWorkTimeRequest.updateMany({ where: { id: { in: old.map(o => o.id) } }, data: { status: 'VOIDED', voidedAt: now, version: { increment: 1 } } });
  const code = job.kind === 'TUNING' ? 'TERMINAL_TOOLING' : 'TERMINAL_ASSIST';
  const category = await tx.otherWorkTimeCategory.upsert({ where: { code }, update: {}, create: { code, name: job.kind === 'TUNING' ? '端子调模工时' : '调模岗位协助工时', sortOrder: 90 } });
  for (const [day, durations] of Object.entries(segmentDays(job.segments, now))) {
    if (!durations.workMs) continue;
    const workDate = new Date(day + 'T00:00:00Z');
    const dated = await employeePolicyOnDate(tx, employee, workDate);
    const attendance = await tx.attendanceRecord.findFirst({ where: { employeeId: employee.id, workDate } });
    const useDated = !attendance?.attainmentPolicyOverride && (Boolean(dated.effectiveDate) || !attendance);
    const teamName = (useDated ? dated.policy.team : attendance?.teamSnapshot) || employee.team;
    const team = teamName ? await tx.productionTeam.findFirst({ where: { OR: [{ name: teamName }, { legacyTeamName: teamName }, { code: teamName }] } }) : null;
    const start = new Date(day + 'T00:00:00+08:00').getTime(), end = start + 86400000;
    const worked = job.segments.filter(s => s.kind === 'WORK' && s.endedAt && s.startedAt.getTime() < end && s.endedAt.getTime() > start);
    const startedAt = new Date(Math.max(start, Math.min(...worked.map(s => s.startedAt.getTime()))));
    const endedAt = new Date(Math.min(end, Math.max(...worked.map(s => s.endedAt!.getTime()))));
    const key = `tooling:${job.id}:${job.version}:${day}`;
    await tx.otherWorkTimeRequest.create({ data: { employeeId: employee.id, createdById: job.actorId, employeeNameSnapshot: employee.name, employeeNoSnapshot: employee.employeeNo, teamSnapshot: teamName, teamIdSnapshot: team?.id,
      attainmentEligibleSnapshot: useDated ? dated.policy.attainmentEligible : attendance?.attainmentEligibleSnapshot ?? dated.policy.attainmentEligible,
      attainmentStreamSnapshot: useDated ? dated.policy.attainmentStream : attendance?.attainmentStreamSnapshot ?? dated.policy.attainmentStream,
      workDate, categoryId: category.id, categoryNameSnapshot: category.name, requestedMinutes: Math.max(1, Math.ceil(durations.workMs / 60000)), reportedMilliseconds: durations.workMs,
      description: `${job.kind === 'TUNING' ? '调模' : job.category}：${(job.terminalSnapshot as { specification?: string }).specification || job.description} ${job.resultNote}`.trim(),
      startedAt, endedAt, status: 'PENDING', submittedAt: now, backfillReason: job.backfillReason, toolingJobId: job.id, idempotencyKey: key, requestHash: createHash('sha256').update(key).digest('hex'), correctionOfId: old.find(o => shanghaiDay(o.workDate.getTime() - 8 * 3600000) === day)?.id } });
  }
  await event(tx, a, 'HOURS_SYNC', { days: segmentDays(job.segments, now) }, job.id);
}
async function assertNoOverlap(tx: Tx, employeeId: string, start: Date, end: Date, exceptId?: string) {
  const conflict = await tx.toolingJob.findFirst({ where: { employeeId, id: exceptId ? { not: exceptId } : undefined, startedAt: { lt: end }, OR: [{ endedAt: { gt: start } }, { endedAt: null }] } });
  const other = await tx.otherWorkTimeRequest.findFirst({ where: { employeeId, toolingJobId: null, status: { in: ['PENDING', 'APPROVED'] }, startedAt: { lt: end }, endedAt: { gt: start } } });
  if (conflict || other) throw new ToolingError('该时段已存在调模或其他协助工时，请调整时间，不能重复报工', 409);
}

export async function worklogCommand(a: ToolingActor, data: Record<string, unknown>) {
  return command(a, data, async tx => {
    const action = text(data.action), now = new Date();
    if (['START', 'BACKFILL', 'BACKSTART'].includes(action)) {
      const employee = await employeeFor(tx, a), kind = data.kind === 'ASSIST' ? 'ASSIST' : 'TUNING';
      if (action !== 'BACKFILL' && await tx.toolingJob.findUnique({ where: { activeEmployee: employee.id } })) throw new ToolingError('你已有进行中的作业，请先完成或继续该作业', 409);
      let terminal = null;
      if (kind === 'TUNING') {
        const id = text(data.terminalId), specification = text(data.specification, 300), manufacturer = text(data.manufacturer, 100) || null;
        if (!id && !specification) throw new ToolingError('请输入端子型号');
        terminal = id ? await tx.terminalToolingTerminal.findUnique({ where: { id } }) : await tx.terminalToolingTerminal.upsert({ where: { normalizedKey: terminalToolingTerminalKey(specification, manufacturer) }, update: {}, create: { specification, manufacturer, normalizedKey: terminalToolingTerminalKey(specification, manufacturer), createdBy: name(a), updatedBy: name(a) } });
        if (!terminal?.isActive) throw new ToolingError('端子不存在或已停用');
      }
      const description = text(data.description), category = text(data.category, 100);
      if (kind === 'ASSIST' && (!description || !category)) throw new ToolingError('请选择协助类型并填写工作内容');
      const backfill = action === 'BACKFILL';
      const adjusted = backfill || action === 'BACKSTART';
      const startedAt = adjusted ? new Date(String(data.startedAt)) : now, endedAt = backfill ? new Date(String(data.endedAt)) : null;
      if (!Number.isFinite(startedAt.getTime()) || startedAt > now || (adjusted && +(endedAt || now) - +startedAt > 86400000) || (endedAt && (!Number.isFinite(endedAt.getTime()) || endedAt <= startedAt || endedAt > now || endedAt.getTime() - startedAt.getTime() > 86400000))) throw new ToolingError('起止时间无效；结束须晚于开始，且不能超过当前时间，单次最多 24 小时');
      const reason = text(data.reason);
      if (adjusted && !reason) throw new ToolingError('请填写补报原因');
      if (adjusted && a.laborRole !== 'ADMIN' && now.getTime() - startedAt.getTime() > 7 * 86400000) throw new ToolingError('仅可补报近 7 天；更早记录请管理员处理');
      if ((employee.hireDate && shanghaiDay(startedAt) < employee.hireDate.toISOString().slice(0, 10)) || (employee.resignedAt && shanghaiDay(startedAt) > employee.resignedAt.toISOString().slice(0, 10))) throw new ToolingError('日期不在员工任职期间');
      await assertNoOverlap(tx, employee.id, startedAt, endedAt || new Date(now.getTime() + 1));
      const setupId = text(data.setupId) || null;
      if (setupId) { const setup = await tx.terminalToolingSetup.findUnique({ where: { id: setupId } }); if (setup?.terminalId !== terminal?.id) throw new ToolingError('参考方案与端子不一致'); }
      const toolingMode = kind === 'TUNING' ? String(data.toolingMode || 'BLADE') as ToolingMode : 'BLADE';
      if (!Object.hasOwn(TOOLING_MODES, toolingMode)) throw new ToolingError('请选择有效的调模方式');
      const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
      const moldId = text(data.moldId);
      if (kind === 'ASSIST' && (moldId || choices.length)) throw new ToolingError('协助报工不能占用调模工装');
      if (toolingMode === 'BLADE' && moldId) throw new ToolingError('刀片调模请勿选择专模');
      if (toolingMode === 'MOLD' && choices.length) throw new ToolingError('专模使用原配刀片；替换刀片请选择组合调模');
      if (toolingMode === 'COMBINATION' && !choices.length) throw new ToolingError('组合调模至少选择一个替换刀位');
      const mold = toolingMode !== 'BLADE' ? await tx.toolingMold.findUnique({ where: { id: moldId } }) : null;
      if (toolingMode !== 'BLADE' && (!mold || (!backfill && mold.state !== 'AVAILABLE'))) throw new ToolingError(mold ? '专模不可用，请先归还、恢复原配或维修后再使用' : '请选择专模型号', 409);
      const job = await tx.toolingJob.create({ data: { toolingMode, recordSource: action === 'START' ? 'REALTIME' : action, actorId: a.id, employeeId: employee.id, employeeNo: employee.employeeNo, actorName: employee.name, kind, status: backfill ? 'COMPLETED' : 'RUNNING', activeEmployee: backfill ? null : employee.id, terminalId: terminal?.id, setupId, terminalSnapshot: json(terminal ? { specification: terminal.specification, manufacturer: terminal.manufacturer } : {}), contextSnapshot: json({ wireRange: text(data.wireRange, 100), equipment: text(data.equipment, 100), mold: mold?.model || text(data.mold, 100) }), description, category, backfillReason: adjusted ? reason : null, startedAt, endedAt, segments: { create: { kind: 'WORK', startedAt, endedAt } } } });
      if (kind === 'TUNING') await allocate(tx, a, job.id, choices, backfill ? startedAt : now, endedAt || undefined);
      if (mold) {
        if (!backfill) await tx.toolingMold.update({ where: { id: mold.id }, data: { state: 'IN_USE', inUseJobId: job.id, currentPosition: null, version: { increment: 1 } } });
        await tx.toolingMoldUsage.create({ data: { jobId: job.id, moldId: mold.id, snapshot: json({ model: mold.model, homePosition: mold.homePosition, pickedPosition: mold.currentPosition }), startedAt: backfill ? startedAt : now, endedAt, disposition: backfill ? 'HISTORICAL' : null } });
      }
      await event(tx, a, action, { kind, toolingMode, description, reason, historicalInventory: backfill }, job.id);
      if (backfill) await syncLedger(tx, a, await tx.toolingJob.findUniqueOrThrow({ where: { id: job.id }, include: toolingJobInclude }), now);
      return { jobId: job.id };
    }
    const jobId = text(data.jobId), job = await tx.toolingJob.findUnique({ where: { id: jobId }, include: toolingJobInclude });
    if (!job) throw new ToolingError('作业记录不存在', 404);
    ownJob(a, job);
    await lock(tx, 'other-work:' + job.employeeId);
    if (job.version !== data.version) throw new ToolingError('记录已更新，请刷新后操作', 409);
    const active = ['RUNNING', 'PAUSED'].includes(job.status);
    if (['PAUSE', 'RESUME', 'FINISH', 'SWAP'].includes(action) && !active) throw new ToolingError('此作业已结束', 409);
    if (action === 'PAUSE' || action === 'RESUME') {
      if (job.status !== (action === 'PAUSE' ? 'RUNNING' : 'PAUSED')) throw new ToolingError('计时状态已变化', 409);
      const reason = text(data.reason); if (action === 'PAUSE' && !reason) throw new ToolingError('请选择暂停原因');
      await tx.toolingSegment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: now } });
      await tx.toolingSegment.create({ data: { jobId, kind: action === 'PAUSE' ? 'WAIT' : 'WORK', reason, startedAt: now } });
      await tx.toolingJob.update({ where: { id: jobId }, data: { status: action === 'PAUSE' ? 'PAUSED' : 'RUNNING', version: { increment: 1 } } });
      await event(tx, a, action, { reason }, jobId);
    } else if (action === 'FINISH') {
      const resultNote = text(data.resultNote, 2000), status = data.result === 'INCOMPLETE' ? 'INCOMPLETE' : 'COMPLETED';
      if (status === 'INCOMPLETE' && !resultNote) throw new ToolingError('请记录未完成原因');
      if (now.getTime() - job.startedAt.getTime() > 16 * 3600000 && !resultNote) throw new ToolingError('本次跨度超过 16 小时，请补充实际情况，结束后可修正时间');
      await tx.toolingSegment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: now } });
      const dispositions = Array.isArray(data.dispositions) ? data.dispositions as Array<Record<string, unknown>> : [];
      for (const usage of job.usages.filter(u => u.isCurrent)) {
        const item = dispositions.find(d => d.usageId === usage.id);
        if (usage.stockId && !item) throw new ToolingError('请确认每个刀位的去向');
        await releaseUsage(tx, usage, item || { disposition: 'DEVICE' }, now);
      }
      if (job.moldUsage) await releaseMold(tx, a, job, data, now);
      await tx.toolingJob.update({ where: { id: jobId }, data: { status, activeEmployee: null, endedAt: now, resultNote, version: { increment: 1 } } });
      await event(tx, a, action, { status, resultNote, dispositions }, jobId);
      await syncLedger(tx, a, await tx.toolingJob.findUniqueOrThrow({ where: { id: jobId }, include: toolingJobInclude }), now);
    } else if (action === 'SWAP') {
      if (job.recordSource === 'BACKFILL' || job.kind !== 'TUNING') throw new ToolingError('此作业不能更换刀片');
      const position = pos(data.position), old = job.usages.find(u => u.isCurrent && u.position === position);
      if (old) { await releaseUsage(tx, old, data, now); await tx.toolingUsage.update({ where: { id: old.id }, data: { isCurrent: false } }); }
      await allocate(tx, a, jobId, [{ position, bladeId: data.bladeId, stockId: data.stockId, reuse: data.reuse }], now);
      await tx.toolingJob.update({ where: { id: jobId }, data: { ...(job.moldUsage ? { toolingMode: 'COMBINATION' } : {}), version: { increment: 1 } } });
      await event(tx, a, action, { position, before: old?.snapshot, bladeId: data.bladeId, stockId: data.stockId }, jobId);
    } else if (action === 'CORRECT') {
      if (active) throw new ToolingError('结束作业后再修正时间');
      const reason = text(data.reason); if (!reason) throw new ToolingError('请填写修正原因');
      const intervals = Array.isArray(data.segments) ? data.segments as Array<Record<string, unknown>> : [];
      if (!intervals.length || intervals.length > 30) throw new ToolingError('请填写实际工作时段');
      const segments = intervals.map(i => ({ kind: 'WORK', startedAt: new Date(String(i.startedAt)), endedAt: new Date(String(i.endedAt)) })).sort((x, y) => +x.startedAt - +y.startedAt);
      for (let i = 0; i < segments.length; i++) { const s = segments[i]; if (!Number.isFinite(+s.startedAt) || !Number.isFinite(+s.endedAt) || s.endedAt <= s.startedAt || s.endedAt > now || (i > 0 && s.startedAt < segments[i - 1].endedAt)) throw new ToolingError('实际工作时段无效或重叠'); }
      if (+segments[segments.length - 1].endedAt - +segments[0].startedAt > 7 * 86400000) throw new ToolingError('修正跨度不能超过 7 天');
      if (a.laborRole !== 'ADMIN' && +now - +job.startedAt > 7 * 86400000) throw new ToolingError('超过 7 天的记录请管理员修正', 403);
      await assertNoOverlap(tx, job.employeeId, segments[0].startedAt, segments[segments.length - 1].endedAt, jobId);
      await event(tx, a, action, { reason, before: job.segments, after: segments }, jobId);
      await tx.toolingSegment.deleteMany({ where: { jobId } });
      await tx.toolingSegment.createMany({ data: segments.map(s => ({ ...s, jobId })) });
      await tx.toolingJob.update({ where: { id: jobId }, data: { startedAt: segments[0].startedAt, endedAt: segments[segments.length - 1].endedAt, backfillReason: reason, version: { increment: 1 } } });
      await syncLedger(tx, a, await tx.toolingJob.findUniqueOrThrow({ where: { id: jobId }, include: toolingJobInclude }), now);
    } else if (action === 'SAVE_RECIPE') {
      if (active || !job.terminalId) throw new ToolingError('请先完成调模');
      if (job.toolingMode !== 'BLADE') throw new ToolingError('专模与组合记录已进入端子历史，下次选择端子可直接复用');
      const context = job.contextSnapshot as { wireRange?: string; equipment?: string; mold?: string };
      const contextKey = terminalToolingContextKey(context);
      const last = await tx.terminalToolingSetup.aggregate({ where: { terminalId: job.terminalId, contextKey }, _max: { version: true } });
      const setup = await tx.terminalToolingSetup.create({ data: { terminalId: job.terminalId, name: (job.terminalSnapshot as { specification: string }).specification + ' 调模记录', ...context, contextKey, version: (last._max.version || 0) + 1, remark: job.resultNote, createdBy: name(a), updatedBy: name(a), positions: { create: job.usages.filter(u => u.isCurrent).map(u => ({ position: u.position, bladeId: u.bladeId })) } } });
      await event(tx, a, action, { setupId: setup.id }, jobId);
      await tx.toolingJob.update({ where: { id: jobId }, data: { version: { increment: 1 } } });
      return { jobId, setupId: setup.id };
    } else throw new ToolingError('操作不支持');
    return { jobId };
  });
}

export async function listToolingWork(a: ToolingActor, params: URLSearchParams) {
  const now = new Date(), range = worklogRange(params.get('period') || 'day', params.get('date') || shanghaiDay(now));
  const mine = params.get('mine') === '1', employeeId = mine ? a.employeeId || '__unbound__' : params.get('employeeId') || undefined;
  const mode = params.get('mode'), source = params.get('source');
  if (mode && !['BLADE','MOLD','COMBINATION','ASSIST'].includes(mode)) throw new ToolingError('调模方式筛选无效');
  if (source && !['REALTIME','BACKFILL','BACKSTART'].includes(source)) throw new ToolingError('记录来源筛选无效');
  const rows = await prisma.toolingJob.findMany({ where: { employeeId, ...(mode === 'ASSIST' ? { kind: 'ASSIST' } : mode ? { kind: 'TUNING', toolingMode: mode } : {}), ...(source ? { recordSource: source } : {}), startedAt: { lt: range.end }, OR: [{ endedAt: { gte: range.start } }, { endedAt: null }] }, include: toolingJobInclude, orderBy: { startedAt: 'desc' } });
  const active = a.employeeId ? await prisma.toolingJob.findUnique({ where: { activeEmployee: a.employeeId }, include: toolingJobInclude }) : null;
  const days: Record<string, { date: string; workMs: number; waitMs: number; tuningMs: number; assistMs: number }> = {};
  const people: Record<string, { employeeId: string; name: string; employeeNo: string; tuningMs: number; assistMs: number; waitMs: number; count: number }> = {};
  for (const row of rows) {
    const person = people[row.employeeId] ||= { employeeId: row.employeeId, name: row.actorName, employeeNo: row.employeeNo, tuningMs: 0, assistMs: 0, waitMs: 0, count: 0 };
    if (row.kind === 'TUNING' && row.endedAt && row.endedAt >= range.start && row.endedAt < range.end) person.count++;
    for (const [date, hours] of Object.entries(segmentDays(row.segments, now, range))) {
      const day = days[date] ||= { date, workMs: 0, waitMs: 0, tuningMs: 0, assistMs: 0 };
      day.workMs += hours.workMs; day.waitMs += hours.waitMs; day[row.kind === 'TUNING' ? 'tuningMs' : 'assistMs'] += hours.workMs;
      person[row.kind === 'TUNING' ? 'tuningMs' : 'assistMs'] += hours.workMs; person.waitMs += hours.waitMs;
    }
  }
  const daily = Object.values(days).sort((x, y) => x.date.localeCompare(y.date)), employees = Object.values(people);
  return { serverNow: now, range, jobs: rows.map(r => ({ ...serialize(r, now), period: Object.values(segmentDays(r.segments, now, range)).reduce((s, d) => ({ workMs: s.workMs + d.workMs, waitMs: s.waitMs + d.waitMs }), { workMs: 0, waitMs: 0 }) })), active: active ? serialize(active, now) : null,
    daily, employees, summary: { count: employees.reduce((s, p) => s + p.count, 0), tuningMs: employees.reduce((s, p) => s + p.tuningMs, 0), assistMs: employees.reduce((s, p) => s + p.assistMs, 0), waitMs: employees.reduce((s, p) => s + p.waitMs, 0), backfillCount: rows.filter(r => r.recordSource !== 'REALTIME').length,
      modes: rows.reduce<Record<string, number>>((sum, row) => { const key = row.kind === 'ASSIST' ? 'ASSIST' : row.toolingMode; sum[key] = (sum[key] || 0) + Object.values(segmentDays(row.segments, now, range)).reduce((n,d) => n+d.workMs,0); return sum; }, {}),
      ongoing: rows.filter(r => !r.endedAt).length } };
}
export async function getToolingJob(id: string) { const job = await prisma.toolingJob.findUnique({ where: { id }, include: toolingJobInclude }); if (!job) throw new ToolingError('作业记录不存在', 404); return serialize(job); }
export async function getToolingReferences(terminalId: string) { const rows = await prisma.toolingJob.findMany({ where: { terminalId, kind: 'TUNING', status: 'COMPLETED', OR: [{ usages: { some: { isCurrent: true } } }, { moldUsage: { isNot: null } }] }, include: toolingJobInclude, orderBy: { endedAt: 'desc' }, take: 8 }); return rows.map(row => serialize(row)); }
