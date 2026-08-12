import { NextResponse } from 'next/server';
import { ForbiddenError, requireUser, unauthorized, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    if (
      !hasCapability(user.access, 'ENGINEERING', 'READ')
      && !hasCapability(user.access, 'QUALITY', 'READ')
      && !hasCapability(user.access, 'CHANGE_MANAGEMENT', 'READ')
    ) throw new ForbiddenError();

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        accountStatus: 'ACTIVE',
        accessGrants: {
          some: {
            isActive: true,
            profile: { not: 'FIELD_REPORTER' },
          },
        },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        isActive: true,
      },
      orderBy: [{ displayName: 'asc' }, { username: 'asc' }],
      take: 500,
    });
    return NextResponse.json({ ok: true, users });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) return unauthorized();
    console.error('change owner options failed', error);
    return NextResponse.json({ ok: false, error: '负责人选项加载失败' }, { status: 500 });
  }
}
