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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const current = await requireNativeUser(req);
    const old = await prisma.user.findUnique({ where: { id: params.id } });
    if (!old) return nativeError('账号不存在', 404);
    const body = await req.json().catch(() => ({})) as { displayName?: string; isActive?: boolean };
    const data: { displayName?: string; isActive?: boolean } = {};
    if (body.displayName !== undefined) data.displayName = String(body.displayName || '').trim().slice(0, 80) || old.username;
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    if (data.isActive === false && old.isActive) {
      const activeCount = await prisma.user.count({ where: { isActive: true } });
      if (activeCount <= 1) return nativeError('不能禁用最后一个可登录账号', 400);
    }
    const user = await prisma.user.update({ where: { id: params.id }, data });
    await logOp({ userId: current.id, action: data.isActive === false ? 'disable_user' : 'update_user', targetType: 'user', targetId: user.id, detail: { username: user.username, fields: Object.keys(data), client: 'harmony_native' } });
    return nativeOk({ user: userDto(user) });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('保存账号失败', 500);
  }
}
