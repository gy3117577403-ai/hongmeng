import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { processTemplateInclude, serializeProcessTemplate, validateProcessSteps } from '@/lib/process-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as {
      name?: unknown;
      isDefault?: unknown;
      steps?: unknown;
    };
    const old = await prisma.processTemplate.findUnique({ where: { id: params.id } });
    if (!old) return NextResponse.json({ ok: false, error: '工艺模板不存在' }, { status: 404 });
    const name = cleanText(body.name, 80) || old.name;
    const validation = validateProcessSteps(body.steps);
    if (!validation.ok) return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    const isDefault = old.isDefault || body.isDefault === true;
    const template = await prisma.$transaction(async tx => {
      if (isDefault) await tx.processTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      await tx.processTemplate.update({ where: { id: old.id }, data: { isActive: false } });
      return tx.processTemplate.create({
        data: {
          templateKey: old.templateKey,
          name,
          version: old.version + 1,
          isDefault,
          isActive: true,
          createdById: user.id,
          steps: {
            create: validation.steps.map(step => ({
              processDefinitionId: step.processDefinitionId,
              processCode: step.processCode,
              processName: step.processName,
              stageGroup: step.stageGroup,
              position: step.position,
            })),
          },
        },
        include: processTemplateInclude,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return NextResponse.json({ ok: true, template: serializeProcessTemplate(template) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ ok: false, error: '模板版本已被其他账号更新，请刷新后重试' }, { status: 409 });
    }
    console.error('create process template version failed', error);
    return NextResponse.json({ ok: false, error: '保存工艺模板新版本失败' }, { status: 500 });
  }
}
