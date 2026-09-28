import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { naturalProductionWeek } from '@/lib/production-execution';
import { activeProductionCarryoverWorkOrderWhere } from '@/lib/production-carryovers';
import { parseWeek, addDays, ymd } from '@/lib/weekly-work-orders';
import { materialOrderInclude, serializeMaterialOrder, readMaterialOrder } from '@/lib/material-order-service';
import { poolWarehouseQueue } from '@/lib/order-pool-warehouse';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const p = req.nextUrl.searchParams;
    if (p.get('planOrderId')) { const t=await prisma.warehouseMaterialTask.findUnique({where:{planOrderId:p.get('planOrderId')!},select:{id:true}});return NextResponse.json({ok:true,order:t?await readMaterialOrder(t.id):null}); }
    if (p.get('scope') === 'pool') return NextResponse.json({ok:true,...await poolWarehouseQueue(p)});
    if (p.get('workOrderId') || p.get('followUpId')) {
      const task = p.get('workOrderId') ? await prisma.warehouseMaterialTask.findUnique({ where: { workOrderId: p.get('workOrderId')! }, select: { id: true } })
        : await prisma.materialFollowUpTask.findUnique({ where: { id: p.get('followUpId')! }, select: { warehouseTaskId: true } });
      const id = task && ('id' in task ? task.id : task.warehouseTaskId);
      return NextResponse.json({ ok: true, order: id ? await readMaterialOrder(id) : null });
    }
    const current = naturalProductionWeek().start;
    const scope = p.get('scope') || 'current', requested = p.get('week');
    const week = requested ? parseWeek(requested) : scope === 'next' ? addDays(current, 7) : scope === 'history' ? addDays(current, -7) : current;
    if (!week || !['current', 'next', 'history', 'overdue'].includes(scope)) return NextResponse.json({ ok: false, error: '计划周不正确' }, { status: 400 });
    const status = p.get('status') || 'active', source = p.get('source') || 'ALL';
    if (!['active', 'all', 'ready', 'waiting', 'unchecked', 'shortage', 'unknown', 'late', 'cancelled'].includes(status) || !['ALL','PURCHASED','CUSTOMER','UNKNOWN'].includes(source)) return NextResponse.json({ ok: false, error: '筛选条件不正确' }, { status: 400 });
    const keyword = String(p.get('q') || '').trim().slice(0, 160);
    const managed: Prisma.WorkOrderWhereInput = { OR: [{ planType: { in: ['weekly_plan', 'managed_plan'] } }, { productionPlanBatch: { is: { deletedAt: null, planOrder: { deletedAt: null } } } }] };
    const period: Prisma.WorkOrderWhereInput = scope === 'overdue' ? { weekStartDate: { lt: current } }
      : { OR: [{ weekStartDate: { gte: week, lt: addDays(week, 1) } }, ...(scope === 'current' ? [activeProductionCarryoverWorkOrderWhere(current)] : [])] };
    const cancelled: Prisma.WorkOrderWhereInput = { OR: [{ deletedAt: { not: null } }, { productionPlanBatch: { is: { OR: [{ deletedAt: { not: null } }, { planOrder: { OR: [{ status: 'cancelled' }, { deletedAt: { not: null } }] } }] } } }] };
    const base: Prisma.WarehouseMaterialTaskWhereInput[] = [ { workOrder: { is: { AND: [status === 'cancelled' ? cancelled : { NOT: cancelled }, managed, period] } } } ];
    const unfinished: Prisma.WarehouseMaterialTaskWhereInput = { OR: [{ status: { not: 'completed' } }, { exceptionCases: { some: { status: 'OPEN' } } }] };
    if (scope === 'overdue') base.push(unfinished);
    if (p.get('view') === 'tracking') base.push({ exceptionCases: { some: {} } });
    if (source !== 'ALL') base.push({ exceptionCases: { some: { supplySource: source } } });
    if (keyword) base.push({ OR: [
      { workOrder: { is: { OR: ['code','customerName','specification','productName'].map(field => ({ [field]: { contains: keyword, mode: 'insensitive' } })) } } },
      { exceptionCases: { some: { OR: [{ materialModel: { contains: keyword, mode: 'insensitive' } }, { exceptionNote: { contains: keyword, mode: 'insensitive' } }, { arrivals: { some: { trackingNumber: { contains: keyword, mode: 'insensitive' } } } }] } } },
    ] });
    const filters: { [key: string]: Prisma.WarehouseMaterialTaskWhereInput } = {
      active: unfinished, ready: { status: 'completed', exceptionCases: { none: { status: 'OPEN' } } },
      waiting: { exceptionCases: { some: { status: 'OPEN', arrivals: { some: { status: 'ARRIVED' } } } } },
      unchecked: { status: 'pending', exceptionCases: { none: {} } },
      shortage: { exceptionCases: { some: { status: 'OPEN' } } },
      unknown: { exceptionCases: { some: { status: 'OPEN', expectedArrivalAt: null, OR: [{ followUpTask: { is: null } }, { followUpTask: { is: { status: { not: 'WAITING_WAREHOUSE' } } } }] } } },
      late: { exceptionCases: { some: { status: 'OPEN', expectedArrivalAt: { lt: new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) + 'T00:00:00+08:00') }, followUpTask: { is: { status: { not: 'WAITING_WAREHOUSE' } } } } } },
      all: {}, cancelled: {},
    };
    const requestedPage = Math.max(1, Math.floor(Number(p.get('page')) || 1)), size = 30;
    const result = await prisma.$transaction(async tx => {
      const where = { AND: [...base, filters[status]] };
      const total = await tx.warehouseMaterialTask.count({ where });
      const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / size)));
      const [orders, counts, older, weeks] = await Promise.all([
        tx.warehouseMaterialTask.findMany({ where, include: materialOrderInclude, orderBy: [{ workOrder: { productionPlanBatch: { planOrder: { customerDueDate: 'asc' } } } }, { createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * size, take: size }),
        Promise.all(['all','active','ready','waiting','unchecked','shortage','unknown','late'].map(async name => [name, await tx.warehouseMaterialTask.count({ where: { AND: [...base, filters[name]] } })] as const)),
        tx.warehouseMaterialTask.count({ where: { AND: [unfinished, { workOrder: { is: { AND: [managed, { NOT: cancelled }, { weekStartDate: { lt: current } }] } } }] } }),
        tx.workOrder.groupBy({ by: ['weekStartDate'], where: { AND: [managed, { deletedAt: null, weekStartDate: { lt: current }, materialTask: { isNot: null } }] }, orderBy: { weekStartDate: 'desc' } }),
      ]);
      return { orders: orders.map(serializeMaterialOrder), summary: Object.fromEntries(counts), older, weeks: weeks.flatMap(w => w.weekStartDate ? [ymd(w.weekStartDate)] : []), currentWeek: ymd(current), week: ymd(week), pagination: { page, total, pages: Math.max(1, Math.ceil(total / size)) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) { if (e instanceof UnauthorizedError) return unauthorized(); console.error('material order query', e); return NextResponse.json({ ok: false, error: '订单加载失败，请重试' }, { status: 500 }); }
}
