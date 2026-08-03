import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import {
  buildEmployeeRosterImportPlan,
  EmployeeRosterImportError,
  parseEmployeeRosterMatrix,
} from '@/lib/employee-roster-import';
import {
  EmployeeNumberReorderError,
  previewEmployeeNumberReorder,
} from '@/lib/employee-number-reorder';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json({ ok: false, error: '请选择目标工号名单文件' }, { status: 400 });
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      return NextResponse.json({ ok: false, error: '仅支持 .xlsx、.xls 或 .csv 文件' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ ok: false, error: '目标工号名单不能超过 5MB' }, { status: 413 });
    }

    const XLSX = await import('xlsx');
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = /\.csv$/i.test(file.name)
      ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', cellDates: false })
      : XLSX.read(buffer, { type: 'buffer', cellDates: false });
    let parsed: ReturnType<typeof parseEmployeeRosterMatrix> | null = null;
    let sourceSheetName: string | null = null;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
        raw: true,
        blankrows: true,
      });
      try {
        parsed = parseEmployeeRosterMatrix(matrix);
        sourceSheetName = sheetName;
        break;
      } catch (error) {
        if (!(error instanceof EmployeeRosterImportError) || error.code !== 'EMPLOYEE_ROSTER_HEADER_MISSING') {
          throw error;
        }
      }
    }
    if (!parsed || !sourceSheetName) {
      throw new EmployeeRosterImportError(
        '工作簿中未找到同时包含“姓名”和“工号”的工作表',
        'EMPLOYEE_ROSTER_HEADER_MISSING',
      );
    }

    const employees = await prisma.employee.findMany({
      orderBy: [{ isActive: 'desc' }, { employeeNo: 'asc' }],
    });
    const plan = buildEmployeeRosterImportPlan({
      employees,
      targetRows: parsed.rows,
      blankHireDateCount: parsed.blankHireDateCount,
    });
    const preview = await previewEmployeeNumberReorder(plan.items);

    return NextResponse.json({
      ok: true,
      preview,
      items: plan.items,
      importSummary: {
        ...plan.summary,
        sourceFileName: file.name,
        sourceSheetName,
        headerRowNo: parsed.headerRowNo,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    if (error instanceof EmployeeRosterImportError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof EmployeeNumberReorderError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error('employee target roster preview failed', error);
    return NextResponse.json({ ok: false, error: '目标工号名单解析失败，请检查文件格式' }, { status: 500 });
  }
}
