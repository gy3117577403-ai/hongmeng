import { NextRequest, NextResponse } from 'next/server';
import { trainingApiError } from '@/lib/training-api';
import { requireTrainingSelfUser } from '@/lib/training-self-auth';
import { resolveTrainingSelfScan, submitTrainingFeedbackSelf } from '@/lib/training-qr-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  try {
    const user = await requireTrainingSelfUser();
    const data = await resolveTrainingSelfScan({ code: params.code, employeeId: user.employeeId! });
    return NextResponse.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return trainingApiError(error, '课后反馈读取失败', 'training self feedback load failed');
  }
}

export async function PUT(request: NextRequest, { params }: { params: { code: string } }) {
  try {
    const user = await requireTrainingSelfUser();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const data = await submitTrainingFeedbackSelf({
      code: params.code,
      employeeId: user.employeeId!,
      body,
    });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return trainingApiError(error, '课后反馈保存失败', 'training self feedback save failed');
  }
}
