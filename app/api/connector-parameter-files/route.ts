import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { serializeConnectorParameterFile } from '@/lib/connector-parameters';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireUser();
    const files = await prisma.connectorParameterFile.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
    });
    return NextResponse.json({ ok: true, files: files.map(serializeConnectorParameterFile) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorized();
    console.error(e);
    return NextResponse.json({ ok: false, error: '原始资料附件加载失败' }, { status: 500 });
  }
}
