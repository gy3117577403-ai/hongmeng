import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { validateNewPassword } from '../lib/password-policy';
import { previewBusinessApprovalHandoff, applyBusinessApprovalHandoff } from '../lib/business-approval-handoff';
async function main(){
 const sourceName=process.env.HM_HANDOFF_ADMIN_USERNAME || 'admin';
 const targetName=process.env.HM_HANDOFF_EMPLOYEE_NAME || '张豪';
 const source=await prisma.user.findUnique({where:{username:sourceName}});
 const targets=await prisma.user.findMany({where:{isActive:true,accountStatus:'ACTIVE',employee:{is:{name:targetName,isActive:true}}}});
 if(!source||targets.length!==1)throw Error('管理员账号不存在，或接替员工不是唯一有效账号；没有修改任何数据');
 const preview=await previewBusinessApprovalHandoff(source.id,targets[0].id);
 if(!process.argv.includes('--apply')){console.log(JSON.stringify({mode:'preview',...preview},null,2));return;}
 if(process.env.HM_HANDOFF_ALLOW!=='authorized-admin-handoff')throw Error('请设置 HM_HANDOFF_ALLOW=authorized-admin-handoff 后执行');
 if(process.env.HM_HANDOFF_FINGERPRINT!==preview.fingerprint)throw Error('请先预览，再以 HM_HANDOFF_FINGERPRINT 指定确认过的清单；未执行修改');
 const password=process.env.HM_ADMIN_NEW_PASSWORD || '';
 const error=validateNewPassword(password,source.username);if(error)throw Error(error);
 const hash=await bcrypt.hash(password,10);
 const result=await applyBusinessApprovalHandoff(source.id,source.id,targets[0].id,preview.fingerprint,hash);
 console.log(JSON.stringify({ok:true,passwordUpdated:true,...result},null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'交接失败');process.exitCode=1;}).finally(()=>prisma.$disconnect());
