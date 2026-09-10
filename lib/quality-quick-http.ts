import { NextResponse } from 'next/server';
import { currentUser, ForbiddenError, UnauthorizedError } from '@/lib/auth';
import { hasCapability } from '@/lib/department-access';
import { QuickQualityError, type QuickActor } from './quality-quick';
export async function quickUser(manage=false) {
  const user=await currentUser();
  if(!user) throw new UnauthorizedError();
  if(user.mustChangePassword) throw new UnauthorizedError();
  if(!hasCapability(user.access,'QUALITY',manage?'UPDATE':'READ') && user.laborRole!=='ADMIN') throw new ForbiddenError();
  return {user,actor:{id:user.id,name:user.displayName||user.username,admin:user.laborRole==='ADMIN',manage:user.laborRole==='ADMIN'||hasCapability(user.access,'QUALITY','UPDATE')} satisfies QuickActor};
}
export async function quickReader() {
  const user=await currentUser();
  if(!user||user.mustChangePassword) throw new UnauthorizedError();
  if(user.laborRole!=='ADMIN'&&!['QUALITY','FIELD_REPORT','QUALITY_DATA','PRODUCTION','ENGINEERING','PLANNING','BUSINESS','DRAWING_LIBRARY'].some(module=>(user.access.capabilities as readonly string[]).includes(module+':READ'))) throw new ForbiddenError();
  return user;
}
export function quickError(error:unknown) {
  if(error instanceof QuickQualityError) return NextResponse.json({ok:false,error:error.message},{status:error.status});
  if(error instanceof UnauthorizedError) return NextResponse.json({ok:false,error:'请登录后操作'},{status:401});
  if(error instanceof ForbiddenError) return NextResponse.json({ok:false,error:'没有此操作权限'},{status:403});
  if(error instanceof SyntaxError) return NextResponse.json({ok:false,error:'请求格式不正确'},{status:400});
  console.error('quality quick failed',error);
  return NextResponse.json({ok:false,error:'操作失败，请保留内容后重试'},{status:500});
}
