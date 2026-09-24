import bcrypt from 'bcryptjs';
import { canManageEmployeeAccountTarget } from '@/lib/employee-account-access';
import { NextRequest, NextResponse } from 'next/server';
import { requireEmployeeAccountAuthorizer, UnauthorizedError, ForbiddenError, unauthorized, forbidden } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertSameOriginMutationRequest } from '@/lib/request-origin';
import { validateNewPassword } from '@/lib/password-policy';
import { AccessGrantInputError, adminUserInclude, serializeAdminUser } from '@/lib/user-access-admin';
export async function POST(request: NextRequest) {
  try {
    assertSameOriginMutationRequest(request); const actor = await requireEmployeeAccountAuthorizer(); const input = await request.json();
    if (typeof input.id !== 'string' || typeof input.enabled !== 'boolean') throw new AccessGrantInputError('请选择账号和手机样品库访问方式');
    const user = await prisma.$transaction(async tx => {
      const previous = await tx.user.findUnique({ where: { id: input.id }, include: adminUserInclude });
      if (!previous) throw new AccessGrantInputError('账号不存在', 404);
      if (!canManageEmployeeAccountTarget(actor, previous) || previous.id===actor.id || previous.laborRole==='ADMIN' || previous.accessGrants.some(grant=>grant.profile==='ADMIN_GLOBAL')) throw new AccessGrantInputError('管理员身份或本人权限请通过既有管理流程维护',403);
      const password = typeof input.password==='string'?input.password:'';
      if (input.enabled && previous.fieldPasswordOnly) { const error=validateNewPassword(password,previous.username); if(error) throw new AccessGrantInputError(`开通手机样品库需设置独立密码：${error}`); }
      const expected = new Date(String(input.expectedUpdatedAt || ''));
      if (!Number.isFinite(expected.getTime())) throw new AccessGrantInputError('缺少账号版本，请刷新',409);
      const reset = input.enabled && previous.fieldPasswordOnly;
      const changed = await tx.user.updateMany({ where: { id: previous.id, updatedAt: expected }, data: { sessionVersion: { increment: 1 }, ...(reset ? { passwordHash: await bcrypt.hash(password,10), fieldPasswordOnly: false, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null } : {}) } });
      if (!changed.count) throw new AccessGrantInputError('账号已被更新，请刷新核对后再保存',409);
      await tx.userAccessGrant.updateMany({ where: { userId: previous.id, profile:'SAMPLE_LIBRARY_READER', isActive:true }, data:{ isActive:false, version:{increment:1}, grantedById:actor.id } });
      if(input.enabled) await tx.userAccessGrant.create({ data:{userId:previous.id,profile:'SAMPLE_LIBRARY_READER',grantType:'CONCURRENT',scopeKey:'MOBILE:SAMPLE_LIBRARY',effectiveFrom:new Date(),grantedById:actor.id} });
      await tx.operationLog.create({ data:{userId:actor.id,action:'SAMPLE_LIBRARY_ACCESS_UPDATED',targetType:'User',targetId:previous.id,detail:{enabled:input.enabled,preservedBusinessGrants:true}} });
      return tx.user.findUniqueOrThrow({where:{id:previous.id},include:adminUserInclude});
    });
    return NextResponse.json({ok:true,user:serializeAdminUser(user)});
  } catch(error) { if(error instanceof UnauthorizedError)return unauthorized();if(error instanceof ForbiddenError)return forbidden();if(error instanceof AccessGrantInputError)return NextResponse.json({ok:false,error:error.message},{status:error.status});console.error('sample library access',error);return NextResponse.json({ok:false,error:'保存失败，请重试'},{status:500}); }
}
