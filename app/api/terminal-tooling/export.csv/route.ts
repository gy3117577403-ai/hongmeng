import { NextRequest } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { csvResponse } from '@/lib/data-tools';
import { logOp } from '@/lib/logs';
import { prisma } from '@/lib/prisma';
import {
  serializeTerminalToolingBlade,
  serializeTerminalToolingTerminal,
  terminalToolingBladeInclude,
  terminalToolingCsv,
  terminalToolingTerminalInclude,
} from '@/lib/terminal-tooling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const entity = req.nextUrl.searchParams.get('entity') === 'blades' ? 'blades' : 'terminals';
    const serialized = entity === 'terminals'
      ? (await prisma.terminalToolingTerminal.findMany({ include: terminalToolingTerminalInclude, orderBy: { specification: 'asc' } })).map(serializeTerminalToolingTerminal)
      : (await prisma.terminalToolingBlade.findMany({ include: terminalToolingBladeInclude, orderBy: { model: 'asc' } })).map(serializeTerminalToolingBlade);
    await logOp({
      userId: user.id,
      action: `export_terminal_tooling_${entity}`,
      targetType: `terminal_tooling_${entity}`,
      detail: { count: serialized.length },
    });
    return csvResponse(entity === 'terminals' ? '端子库.csv' : '刀片库.csv', terminalToolingCsv(entity, serialized));
  } catch (error) {
    if (error instanceof UnauthorizedError) return unauthorized();
    console.error(error);
    return Response.json({ ok: false, error: '端子调模资料导出失败' }, { status: 500 });
  }
}
