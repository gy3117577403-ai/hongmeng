import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  cleanProcessText,
  parseProcessTimeBasis,
  secondsToMilliseconds,
  serializeProcessTimeStandard,
} from '@/lib/process-time';
import type { ProcessStageGroup } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const definitionInclude = Prisma.validator<Prisma.ProcessDefinitionInclude>()({
  timeStandards: {
    orderBy: { version: 'desc' },
    include: {
      createdBy: { select: { id: true, username: true, displayName: true } },
    },
  },
  _count: { select: { templateSteps: true, routeSteps: true } },
});

function stageGroup(value: unknown): ProcessStageGroup {
  return value === 'backend' || value === 'finish' ? value : 'frontend';
}

function serializeDefinition(definition: Prisma.ProcessDefinitionGetPayload<{ include: typeof definitionInclude }>) {
  const history = definition.timeStandards.map(serializeProcessTimeStandard);
  return {
    id: definition.id,
    code: definition.code,
    name: definition.name,
    stageGroup: stageGroup(definition.stageGroup),
    isActive: definition.isActive,
    sortOrder: definition.sortOrder,
    currentStandard: history.find(item => item.isCurrent) || null,
    standardHistory: history,
    templateUsageCount: definition._count.templateSteps,
    routeUsageCount: definition._count.routeSteps,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const definition = await prisma.$transaction(async tx => {
      const existing = await tx.processDefinition.findUnique({
        where: { id: params.id },
        include: { timeStandards: { orderBy: { version: 'desc' } } },
      });
      if (!existing) throw new Error('PROCESS_NOT_FOUND');
      const current = existing.timeStandards.find(item => item.isCurrent) || null;
      const name = body.name === undefined ? existing.name : cleanProcessText(body.name, 60);
      if (!name) throw new Error('PROCESS_NAME_REQUIRED');
      if (name.toLocaleLowerCase() !== existing.name.toLocaleLowerCase()) {
        const duplicate = await tx.processDefinition.findFirst({
          where: { id: { not: existing.id }, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        });
        if (duplicate) throw new Error('PROCESS_NAME_DUPLICATE');
      }
      const updatedDefinition = await tx.processDefinition.update({
        where: { id: existing.id },
        data: {
          name,
          stageGroup: body.stageGroup === undefined ? existing.stageGroup : stageGroup(body.stageGroup),
          isActive: body.isActive === undefined ? existing.isActive : body.isActive === true,
          sortOrder: body.sortOrder === undefined || !Number.isInteger(Number(body.sortOrder))
            ? existing.sortOrder
            : Number(body.sortOrder),
        },
      });

      const standardRequested = body.standardSeconds !== undefined;
      let standardChanged = false;
      if (standardRequested) {
        const next = {
          timeBasis: parseProcessTimeBasis(body.timeBasis),
          unitLabel: cleanProcessText(body.unitLabel, 20) || '件',
          standardMillisecondsPerUnit: secondsToMilliseconds(body.standardSeconds, '单位标准时间'),
          setupMilliseconds: secondsToMilliseconds(body.setupSeconds ?? 0, '固定准备时间', true),
          countsForEfficiency: body.countsForEfficiency !== false,
          remark: cleanProcessText(body.remark, 500) || null,
        };
        standardChanged = !current
          || current.timeBasis !== next.timeBasis
          || current.unitLabel !== next.unitLabel
          || current.standardMillisecondsPerUnit !== next.standardMillisecondsPerUnit
          || current.setupMilliseconds !== next.setupMilliseconds
          || current.countsForEfficiency !== next.countsForEfficiency
          || current.remark !== next.remark;
        if (standardChanged) {
          await tx.processTimeStandard.updateMany({
            where: { processDefinitionId: existing.id, isCurrent: true },
            data: { isCurrent: false },
          });
          await tx.processTimeStandard.create({
            data: {
              processDefinitionId: existing.id,
              version: (existing.timeStandards[0]?.version || 0) + 1,
              ...next,
              isCurrent: true,
              createdById: user.id,
            },
          });
        }
      }
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: standardChanged ? 'update_process_time_standard' : 'update_process_definition',
          targetType: 'process_definition',
          targetId: existing.id,
          detail: {
            processCode: updatedDefinition.code,
            standardVersion: standardChanged ? (existing.timeStandards[0]?.version || 0) + 1 : current?.version || null,
            active: updatedDefinition.isActive,
          },
        },
      });
      return tx.processDefinition.findUniqueOrThrow({
        where: { id: existing.id },
        include: definitionInclude,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, definition: serializeDefinition(definition) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error) {
      if (error.message === 'PROCESS_NOT_FOUND') return NextResponse.json({ ok: false, error: '工序不存在' }, { status: 404 });
      if (error.message === 'PROCESS_NAME_REQUIRED') return NextResponse.json({ ok: false, error: '工序名称不能为空' }, { status: 400 });
      if (error.message === 'PROCESS_NAME_DUPLICATE') return NextResponse.json({ ok: false, error: '同名工序已经存在' }, { status: 409 });
      if (!('code' in error)) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error('update process time standard failed', error);
    return NextResponse.json({ ok: false, error: '保存标准工时失败' }, { status: 500 });
  }
}
