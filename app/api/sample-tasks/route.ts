import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import {
  drawingLibraryKey,
  invalidSpecificationReason,
  parseCustomerCode,
} from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import {
  cleanSampleColor,
  cleanSampleText,
  parseOptionalNonNegativeInteger,
  parseOptionalSampleDate,
  sampleActor,
  sampleQrCode,
  sampleTaskCode,
  sampleTaskInclude,
  serializeSampleTask,
} from '@/lib/sample-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function employeeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanSampleText(item, 80)).filter((item): item is string => Boolean(item)))].slice(0, 30);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const keyword = cleanSampleText(req.nextUrl.searchParams.get('keyword'), 100);
    const status = cleanSampleText(req.nextUrl.searchParams.get('status'), 30);
    const dataStatus = cleanSampleText(req.nextUrl.searchParams.get('dataStatus'), 40);
    const assignedToMe = req.nextUrl.searchParams.get('assignedToMe') === 'true';
    const tasks = await prisma.sampleTask.findMany({
      where: {
        deletedAt: null,
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(dataStatus && dataStatus !== 'ALL' ? { dataStatus } : {}),
        ...(assignedToMe && user.employeeId
          ? { assignees: { some: { employeeId: user.employeeId } } }
          : {}),
        ...(keyword
          ? {
              OR: [
                { code: { contains: keyword, mode: 'insensitive' } },
                { sourceOrderNo: { contains: keyword, mode: 'insensitive' } },
                { customerNameSnapshot: { contains: keyword, mode: 'insensitive' } },
                { productNameSnapshot: { contains: keyword, mode: 'insensitive' } },
                { specificationSnapshot: { contains: keyword, mode: 'insensitive' } },
                { customerLevelCode: { contains: keyword, mode: 'insensitive' } },
                { assignees: { some: { employee: { name: { contains: keyword, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      },
      include: sampleTaskInclude,
      orderBy: [
        { status: 'asc' },
        { priority: 'desc' },
        { dueDate: 'asc' },
        { updatedAt: 'desc' },
      ],
      take: 300,
    });
    const serialized = tasks.map(serializeSampleTask);
    const today = chinaDateKey(new Date());
    const active = serialized.filter(task => task.status !== 'CANCELLED');
    const summary = {
      total: active.length,
      dueToday: active.filter(task => task.dueDate === today && task.status !== 'COMPLETED').length,
      overdue: active.filter(task => Boolean(task.dueDate && task.dueDate < today) && task.status !== 'COMPLETED').length,
      pendingReview: active.reduce((count, task) => count + task.counts.pendingReview, 0),
      collecting: active.filter(task => task.status === 'PLANNED' || task.status === 'IN_PROGRESS').length,
      completed: active.filter(task => task.status === 'COMPLETED').length,
      publishedItems: active.reduce((sum, task) => sum + task.counts.published, 0),
    };
    return NextResponse.json({ ok: true, tasks: serialized, summary });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('sample task list failed', error);
    return NextResponse.json({ ok: false, error: '样品任务加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const actor = sampleActor(user);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const drawingLibraryItemId = cleanSampleText(body.drawingLibraryItemId, 80);
    const customerName = cleanSampleText(body.customerName, 160);
    const productName = cleanSampleText(body.productName, 180);
    const specification = cleanSampleText(body.specification, 180);
    const assignedEmployeeIds = employeeIds(body.assigneeEmployeeIds);
    const dueDate = parseOptionalSampleDate(body.dueDate);
    const sampleQuantity = parseOptionalNonNegativeInteger(body.sampleQuantity);
    const priority = parseOptionalNonNegativeInteger(body.priority, 9) ?? 0;

    if (!drawingLibraryItemId && (!customerName || !specification)) {
      return NextResponse.json({ ok: false, error: '请选择现有产品，或填写客户和产品规格建立样品主档' }, { status: 400 });
    }
    if (!drawingLibraryItemId && specification) {
      const reason = invalidSpecificationReason(specification);
      if (reason) return NextResponse.json({ ok: false, error: `产品规格格式异常：${reason}` }, { status: 400 });
    }

    const taskId = await prisma.$transaction(async tx => {
      let item = drawingLibraryItemId
        ? await tx.drawingLibraryItem.findFirst({ where: { id: drawingLibraryItemId, deletedAt: null } })
        : null;
      if (drawingLibraryItemId && !item) throw new Error('SAMPLE_PRODUCT_NOT_FOUND');
      if (!item) {
        const key = drawingLibraryKey(customerName === '未设置' ? '' : customerName, specification!);
        const existing = await tx.drawingLibraryItem.findUnique({ where: { libraryKey: key } });
        item = existing
          ? await tx.drawingLibraryItem.update({
              where: { id: existing.id },
              data: {
                customerName: customerName!,
                customerCode: parseCustomerCode(customerName),
                productName: productName || existing.productName,
                specification: specification!,
                deletedAt: null,
              },
            })
          : await tx.drawingLibraryItem.create({
              data: {
                customerName: customerName!,
                customerCode: parseCustomerCode(customerName),
                productName,
                specification: specification!,
                libraryKey: key,
              },
            });
      }

      const employees = assignedEmployeeIds.length
        ? await tx.employee.findMany({
            where: { id: { in: assignedEmployeeIds }, isActive: true, resignedAt: null },
            select: { id: true },
          })
        : [];
      const created = await tx.sampleTask.create({
        data: {
          code: sampleTaskCode(),
          qrCode: sampleQrCode(),
          drawingLibraryItemId: item.id,
          sourceOrderNo: cleanSampleText(body.sourceOrderNo, 120),
          customerNameSnapshot: item.customerName,
          productNameSnapshot: item.productName,
          specificationSnapshot: item.specification,
          customerLevelCode: cleanSampleText(body.customerLevelCode, 30),
          customerLevelLabel: cleanSampleText(body.customerLevelLabel, 60),
          customerLevelColor: cleanSampleColor(body.customerLevelColor),
          sampleQuantity,
          dueDate,
          priority,
          planRemark: cleanSampleText(body.planRemark, 1000),
          createdById: actor.id,
          createdByName: actor.name,
          updatedById: actor.id,
          updatedByName: actor.name,
          assignees: employees.length
            ? {
                create: employees.map(employee => ({
                  employeeId: employee.id,
                  assignedById: actor.id,
                  assignedByName: actor.name,
                })),
              }
            : undefined,
        },
        select: { id: true, code: true },
      });
      await tx.operationLog.create({
        data: {
          userId: actor.id,
          action: 'create_sample_task',
          targetType: 'sample_task',
          targetId: created.id,
          detail: {
            code: created.code,
            drawingLibraryItemId: item.id,
            assigneeCount: employees.length,
            customerLevelCode: cleanSampleText(body.customerLevelCode, 30),
          },
        },
      });
      return created.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const task = await prisma.sampleTask.findUnique({ where: { id: taskId }, include: sampleTaskInclude });
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'SAMPLE_PRODUCT_NOT_FOUND') return NextResponse.json({ ok: false, error: '选择的产品资料不存在' }, { status: 404 });
      if (error.message === 'INVALID_SAMPLE_DATE') return NextResponse.json({ ok: false, error: '计划完成日期格式无效' }, { status: 400 });
      if (error.message === 'INVALID_SAMPLE_NUMBER') return NextResponse.json({ ok: false, error: '数量或优先级格式无效' }, { status: 400 });
    }
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ ok: false, error: '样品任务编号冲突，请重新提交' }, { status: 409 });
    console.error('create sample task failed', error);
    return NextResponse.json({ ok: false, error: '样品任务创建失败' }, { status: 500 });
  }
}
