import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { logOp } from '@/lib/logs';
import { NativeUnauthorizedError, nativeError, nativeOk, nativeUnauthorized, requireNativeUser } from '@/lib/native-api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const sessionUser = await requireNativeUser(req);
    const body = await req.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string; confirmPassword?: string };
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    const confirmPassword = String(body.confirmPassword || '');
    if (!currentPassword || !newPassword || !confirmPassword) return nativeError('请完整填写密码信息', 400);
    if (newPassword.length < 6) return nativeError('新密码至少 6 位', 400);
    if (newPassword !== confirmPassword) return nativeError('两次密码不一致', 400);

    const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!user || !user.isActive) return nativeUnauthorized();
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return nativeError('当前密码错误', 400);

    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
    await logOp({ userId: user.id, action: 'change_password', targetType: 'user', targetId: user.id, detail: { client: 'harmony_native' } });
    return nativeOk({ changed: true, message: '密码修改成功，请重新登录' });
  } catch (e) {
    if (e instanceof NativeUnauthorizedError) return nativeUnauthorized();
    console.error(e);
    return nativeError('修改密码失败', 500);
  }
}
