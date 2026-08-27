import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { readTrainingLedger } from '@/lib/training-ledger';
import { TrainingInputError } from '@/lib/training';
import { trainingDateTimeInput } from '@/lib/training-time';
import { createTrainingWorkbook } from '@/lib/training-workbook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const ledger = await readTrainingLedger(req.nextUrl.searchParams);
    const { rows, startDate, endDate, planCount, employeeCount } = ledger;
    if (req.nextUrl.searchParams.get('preview') === '1') {
      return NextResponse.json({ ok: true, planCount, employeeCount, rowCount: rows.length, startDate, endDate, timeZone: 'Asia/Shanghai' }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const generatedAt = trainingDateTimeInput(new Date()).replace('T', ' ');
    const buffer = await createTrainingWorkbook({ startDate, endDate, generatedAt, rows });
    await logOp({
      userId: user.id, action: 'export_training_workbook', targetType: 'training_plan',
      detail: { startDate, endDate, planCount, participantRowCount: rows.length, sheetCount: 1, timeZone: 'Asia/Shanghai', dateBasis: 'plan_start', planId: req.nextUrl.searchParams.get('planId') },
    });
    const fileName = '培训台账_' + startDate + '_' + endDate + '.xlsx';
    return new NextResponse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(fileName),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof TrainingInputError) return NextResponse.json({ ok: false, error: error.message }, { status: error.statusCode });
    const message = error instanceof Error ? error.message : '培训台账导出失败';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
