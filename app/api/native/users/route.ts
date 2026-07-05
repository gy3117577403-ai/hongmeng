import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function userDto(user: { id: string; username: string; displayName: string; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireNativeUser(req);
    const users = await prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] });
    return nativeOk({ users: users.map(userDto) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('账号列表加载失败', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const current = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as { username?: string; displayName?: string; password?: string };
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim() || username;
    const password = String(body.password || '');
    if (!username) return nativeError('账号不能为空', 400);
    if (password.length < 6) return nativeError('初始密码至少 6 位', 400);
    const user = await prisma.user.create({
      data: { username, displayName: displayName.slice(0, 80), passwordHash: await bcrypt.hash(password, 10), isActive: true },
    });
    await logOp({ userId: current.id, action: 'create_user', targetType: 'user', targetId: user.id, detail: { username, client: 'harmony_native' } });
    return nativeOk({ user: userDto(user) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    if ((e as { code?: string }).code === 'P2002') return nativeError('账号已存在', 409);
    console.error(e);
    return nativeError('新增账号失败', 500);
  }
}
