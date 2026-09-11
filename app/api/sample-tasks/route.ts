import { listSamplePlans, SampleQueryError } from '@/lib/sample-plan-query';
import { NextRequest, NextResponse } from 'next/server';
import { DrawingLibraryResolutionError, resolveOrCreateDrawingProduct } from '@/lib/drawing-library-resolution';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { chinaDateKey } from '@/lib/china-date';
import {
  drawingLibraryKey,
  invalidSpecificationReason,
  parseCustomerCode,
} from '@/lib/drawing-library';
import { prisma } from '@/lib/prisma';
import { sampleCustomerLevel } from '@/lib/sample-customer-levels';
import {
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
    return NextResponse.json(await listSamplePlans(req.nextUrl.searchParams, user.employeeId));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof SampleQueryError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
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
    const issuedDate = parseOptionalSampleDate(body.issuedDate || chinaDateKey(new Date()));
    const warningDays = body.warningDays === undefined ? 2 : Number(body.warningDays);
    if (!Number.isInteger(warningDays) || warningDays < 0 || warningDays > 30) return NextResponse.json({ ok: false, error: '提前预警天数须为 0 至 30 的整数' }, { status: 400 });
    if (issuedDate && dueDate && dueDate < issuedDate) return NextResponse.json({ ok: false, error: '出货日期不能早于下达日期' }, { status: 400 });
    const sampleQuantity = parseOptionalNonNegativeInteger(body.sampleQuantity);
    const customerLevel = sampleCustomerLevel(body.customerLevelCode);
    const dataPurpose = body.dataPurpose === 'TEST' || body.dataPurpose === 'TRAINING' ? body.dataPurpose : 'PRODUCTION';

    if (!drawingLibraryItemId && (!customerName || !specification)) {
      return NextResponse.json({ ok: false, error: '请选择现有产品，或填写客户和产品规格建立样品主档' }, { status: 400 });
    }
    if (!drawingLibraryItemId && specification) {
      const reason = invalidSpecificationReason(specification);
      if (reason) return NextResponse.json({ ok: false, error: `产品规格格式异常：${reason}` }, { status: 400 });
    }
    if (!customerLevel) {
      return NextResponse.json({ ok: false, error: '客户等级只能选择 A、B、C、D' }, { status: 400 });
    }
    if (dataPurpose !== 'PRODUCTION' && user.laborRole !== 'ADMIN') {
      return NextResponse.json({ ok: false, error: '只有系统管理员可以创建测试或培训样品任务' }, { status: 403 });
    }

    const taskId = await prisma.$transaction(async tx => {
      let item = drawingLibraryItemId
        ? await tx.drawingLibraryItem.findFirst({ where: { id: drawingLibraryItemId, deletedAt: null } })
        : null;
      if (drawingLibraryItemId && !item) throw new Error('SAMPLE_PRODUCT_NOT_FOUND');
      if (!item) {
        item = await resolveOrCreateDrawingProduct(tx, { customerName: customerName!, specification: specification!, productName });
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
          customerLevelCode: customerLevel.code,
          customerLevelLabel: customerLevel.label,
          customerLevelColor: customerLevel.color,
          sampleQuantity,
          dueDate,
          issuedDate,
          warningDays,
          priority: customerLevel.priority,
          dataPurpose,
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
            customerLevelCode: customerLevel.code,
            dataPurpose,
          },
        },
      });
      return created.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const task = await prisma.sampleTask.findUnique({ where: { id: taskId }, include: sampleTaskInclude });
    return NextResponse.json({ ok: true, task: task ? serializeSampleTask(task) : null }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof DrawingLibraryResolutionError) return NextResponse.json({ ok: false, error: error.message, code: error.code, itemIds: error.itemIds }, { status: 409 });
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
