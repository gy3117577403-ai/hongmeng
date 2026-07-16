import { randomUUID } from 'node:crypto';
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

function standardInput(body: Record<string, unknown>) {
  return {
    timeBasis: parseProcessTimeBasis(body.timeBasis),
    unitLabel: cleanProcessText(body.unitLabel, 20) || '件',
    standardMillisecondsPerUnit: secondsToMilliseconds(body.standardSeconds, '单位标准时间'),
    setupMilliseconds: secondsToMilliseconds(body.setupSeconds ?? 0, '固定准备时间', true),
    countsForEfficiency: body.countsForEfficiency !== false,
    remark: cleanProcessText(body.remark, 500) || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const keyword = cleanProcessText(req.nextUrl.searchParams.get('keyword'), 80);
    const status = req.nextUrl.searchParams.get('status');
    const definitions = await prisma.processDefinition.findMany({
      where: {
        ...(status === 'active' ? { isActive: true } : status === 'inactive' ? { isActive: false } : {}),
        ...(keyword
          ? {
              OR: [
                { name: { contains: keyword, mode: 'insensitive' } },
                { code: { contains: keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: definitionInclude,
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return NextResponse.json({
      ok: true,
      definitions: definitions.map(serializeDefinition),
      summary: {
        total: definitions.length,
        active: definitions.filter(item => item.isActive).length,
        standardized: definitions.filter(item => item.timeStandards.some(standard => standard.isCurrent)).length,
        pending: definitions.filter(item => item.isActive && !item.timeStandards.some(standard => standard.isCurrent)).length,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process time standards list failed', error);
    return NextResponse.json({ ok: false, error: '标准工时加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const name = cleanProcessText(body.name, 60);
    if (!name) return NextResponse.json({ ok: false, error: '请填写工序名称' }, { status: 400 });
    const duplicate = await prisma.processDefinition.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (duplicate) return NextResponse.json({ ok: false, error: '同名工序已经存在，请直接维护其标准工时' }, { status: 409 });
    const standard = standardInput(body);
    const code = `process-${randomUUID()}`;
    const definition = await prisma.$transaction(async tx => {
      const created = await tx.processDefinition.create({
        data: {
          code,
          name,
          stageGroup: stageGroup(body.stageGroup),
          isActive: true,
          sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 1000,
          timeStandards: {
            create: {
              version: 1,
              ...standard,
              createdById: user.id,
            },
          },
        },
        include: definitionInclude,
      });
      await tx.operationLog.create({
        data: {
          userId: user.id,
          action: 'create_process_time_standard',
          targetType: 'process_definition',
          targetId: created.id,
          detail: { processCode: created.code, version: 1 },
        },
      });
      return created;
    });
    return NextResponse.json({ ok: true, definition: serializeDefinition(definition) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Error && !('code' in error)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error('create process time standard failed', error);
    return NextResponse.json({ ok: false, error: '新增标准工时失败' }, { status: 500 });
  }
}
