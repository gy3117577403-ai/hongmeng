import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  prepareTrainingPlanChange,
  readTrainingPlanLifecycleImpact,
} from '@/lib/training-plan-lifecycle';
import { TrainingInputError } from '@/lib/training';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const prepared = await prepareTrainingPlanChange(params.id, body);
    const impact = await prisma.$transaction(tx => readTrainingPlanLifecycleImpact(tx, prepared.current.id));
    return NextResponse.json({
      ok: true,
      preview: {
        plan: {
          id: prepared.current.id,
          code: prepared.current.code,
          title: prepared.current.title,
          status: prepared.current.status,
          version: prepared.current.version,
        },
        changedFields: prepared.changedFields,
        addedParticipantCount: prepared.addedEmployeeIds.length,
        removedParticipantCount: prepared.removedParticipantIds.length,
        impact,
        blockers: prepared.blockers,
        warnings: prepared.warnings,
        requiresConfirmation: prepared.requiresConfirmation,
        canApply: prepared.blockers.length === 0,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    }
    console.error('preview training plan change failed', error);
    return NextResponse.json({ ok: false, error: '培训计划变更影响计算失败' }, { status: 500 });
  }
}
