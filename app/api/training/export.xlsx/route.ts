import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import { reportDateRange } from '@/lib/report-date-range';
import { createTrainingWorkbook } from '@/lib/training-workbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const range = reportDateRange({
      period: req.nextUrl.searchParams.get('period'),
      date: req.nextUrl.searchParams.get('date'),
      startDate: req.nextUrl.searchParams.get('startDate'),
      endDate: req.nextUrl.searchParams.get('endDate'),
      fallbackPeriod: 'month',
    });
    const plans = await prisma.trainingPlan.findMany({
      where: { deletedAt: null, startAt: { lt: range.end }, endAt: { gte: range.start } },
      include: { course: true, participants: true },
      orderBy: [{ startAt: 'asc' }, { code: 'asc' }],
    });
    const rows = plans.flatMap(plan => plan.participants.map(participant => ({
      planCode: plan.code,
      planTitle: plan.title,
      courseName: plan.course?.name || '临时培训',
      startAt: plan.startAt,
      endAt: plan.endAt,
      employeeNo: participant.employeeNoSnapshot,
      employeeName: participant.employeeNameSnapshot,
      department: participant.departmentSnapshot,
      team: participant.teamSnapshot,
      position: participant.positionSnapshot,
      attendanceStatus: participant.attendanceStatus,
      actualMinutes: participant.actualMinutes,
      theoryScore: participant.theoryScore,
      practicalScore: participant.practicalScore,
      score: participant.score,
      result: participant.result,
      reviewStatus: participant.reviewStatus,
      certificationId: participant.certificationId,
    })));
    const startDate = dateKey(range.start);
    const endDate = dateKey(new Date(range.end.getTime() - 1));
    const buffer = await createTrainingWorkbook({
      startDate,
      endDate,
      generatedAt: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date()),
      rows,
    });
    await logOp({
      userId: user.id,
      action: 'export_training_workbook',
      targetType: 'training_plan',
      detail: { startDate, endDate, planCount: plans.length, participantRowCount: rows.length, sheetCount: 1 },
    });
    const fileName = `员工培训发展记录表_${startDate}_${endDate}.xlsx`;
    const responseBody = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    const message = error instanceof Error ? error.message : '培训台账导出失败';
    console.error('training workbook export failed', error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
