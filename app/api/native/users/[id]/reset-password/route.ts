import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as { password?: string };
    const password = String(body.password || '');
    if (password.length < 6) return nativeError('新密码至少 6 位', 400);
    const old = await prisma.user.findUnique({ where: { id: params.id } });
    if (!old) return nativeError('账号不存在', 404);
    await prisma.user.update({ where: { id: params.id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await logOp({ userId: current.id, action: 'reset_user_password', targetType: 'user', targetId: old.id, detail: { username: old.username, client: 'harmony_native' } });
    return nativeOk({ reset: true });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('重置密码失败', 500);
  }
}
