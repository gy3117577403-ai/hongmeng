import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { processTemplateInclude, serializeProcessTemplate, validateProcessSteps } from '@/lib/process-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max);
}

export async function GET() {
  try {
    await requireUser();
    const templates = await prisma.processTemplate.findMany({
      include: processTemplateInclude,
      orderBy: [{ templateKey: 'asc' }, { version: 'desc' }],
    });
    return NextResponse.json({ ok: true, templates: templates.map(serializeProcessTemplate) });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('process template list failed', error);
    return NextResponse.json({ ok: false, error: '工艺模板加载失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({})) as {
      name?: unknown;
      isDefault?: unknown;
      steps?: unknown;
    };
    const name = cleanText(body.name, 80);
    if (!name) return NextResponse.json({ ok: false, error: '请填写模板名称' }, { status: 400 });
    const validation = validateProcessSteps(body.steps);
    if (!validation.ok) return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    const templateKey = `custom-${randomUUID()}`;
    const isDefault = body.isDefault === true;
    const template = await prisma.$transaction(async tx => {
      if (isDefault) await tx.processTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      return tx.processTemplate.create({
        data: {
          templateKey,
          name,
          version: 1,
          isDefault,
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
    });
    return NextResponse.json({ ok: true, template: serializeProcessTemplate(template) }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error('create process template failed', error);
    return NextResponse.json({ ok: false, error: '新建工艺模板失败' }, { status: 500 });
  }
}
