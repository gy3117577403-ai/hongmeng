import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeEmployee } from '@/lib/process-time';
import { resolveEffectiveFrontendTransferredQty } from '@/lib/production-stage-flow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const stepId = String(req.nextUrl.searchParams.get('stepId') || '').trim();
    if (!stepId) return NextResponse.json({ ok: false, error: '缺少工序标识' }, { status: 400 });
    const [step, employees] = await Promise.all([
      prisma.workOrderProcessStep.findUnique({
        where: { id: stepId },
        include: {
          standardTime: true,
          processDefinition: {
            include: {
              timeStandards: {
                where: { isCurrent: true },
                take: 1,
              },
            },
          },
          route: { include: { workOrder: true } },
        },
      }),
      prisma.employee.findMany({
        where: { isActive: true },
        orderBy: [{ employeeNo: 'asc' }],
      }),
    ]);
    if (!step) return NextResponse.json({ ok: false, error: '当前工序不存在' }, { status: 404 });
    if (step.status !== 'current') {
      return NextResponse.json({ ok: false, error: '当前工序状态已经变化，请刷新后重试' }, { status: 409 });
    }
    const currentStandard = step.processDefinition?.timeStandards[0] || null;
    const hasSnapshot = Boolean(step.standardMillisecondsPerUnit && step.timeBasis && step.unitLabel);
    const standard = hasSnapshot
      ? {
          standardTimeId: step.standardTimeId,
          version: step.standardVersion,
          timeBasis: step.timeBasis === 'per_batch' ? 'per_batch' as const : 'per_unit' as const,
          unitLabel: step.unitLabel || '件',
          standardMillisecondsPerUnit: step.standardMillisecondsPerUnit || 0,
          setupMilliseconds: step.setupMilliseconds,
          unitsPerProduct: step.unitsPerProduct,
          countsForEfficiency: step.countsForEfficiency,
        }
      : currentStandard
        ? {
            standardTimeId: currentStandard.id,
            version: currentStandard.version,
            timeBasis: currentStandard.timeBasis === 'per_batch' ? 'per_batch' as const : 'per_unit' as const,
            unitLabel: currentStandard.unitLabel,
            standardMillisecondsPerUnit: currentStandard.standardMillisecondsPerUnit,
            setupMilliseconds: currentStandard.setupMilliseconds,
            unitsPerProduct: step.unitsPerProduct,
            countsForEfficiency: currentStandard.countsForEfficiency,
          }
        : null;
    const resolution = resolveEffectiveFrontendTransferredQty(step.route.workOrder);
    const targetQuantity = resolution.ok ? resolution.state.targetQty : 0;
    return NextResponse.json({
      ok: true,
      context: {
        stepId: step.id,
        processName: step.processName,
        processCode: step.processCode,
        targetQuantity,
        suggestedStartedAt: (step.startedAt || new Date()).toISOString(),
        suggestedEndedAt: new Date().toISOString(),
        standard,
        employees: employees.map(serializeEmployee),
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process execution context failed', error);
    return NextResponse.json({ ok: false, error: '工序报工信息加载失败' }, { status: 500 });
  }
}
