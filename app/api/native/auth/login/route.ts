import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { createToken } from '@/lib/auth';
import { logOp } from '@/lib/logs';
import { nativeError, nativeOk } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { username?: string; password?: string };
    const username = body.username?.trim();
    const password = body.password || '';
    if (!username || !password) return nativeError('请输入账号和密码', 400);

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user?.isActive || !(await bcrypt.compare(password, user.passwordHash))) return nativeError('账号或密码错误', 401);

    const token = createToken({ userId: user.id, username: user.username });
    await logOp({ userId: user.id, action: 'login', targetType: 'user', targetId: user.id, detail: { client: 'harmony_native' } });
    return nativeOk({
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    });
  } catch (e) {
    console.error(e);
    return nativeError('登录服务异常', 500);
  }
}
