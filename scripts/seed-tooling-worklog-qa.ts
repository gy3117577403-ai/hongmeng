import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { TerminalToolingBlade } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { inventoryCommand,worklogCommand } from '../lib/tooling-worklog-service';
import { TOOLING_POSITIONS } from '../lib/tooling-worklog-domain';
import { terminalToolingBladeKey,terminalToolingTerminalKey,terminalToolingContextKey } from '../lib/terminal-tooling';
async function main(){
  const url=new URL(process.env.DATABASE_URL||'');if(!['127.0.0.1','localhost'].includes(url.hostname)||!['/tooling250','/hongmeng_ci'].includes(url.pathname))throw new Error('Only isolated tooling QA database');
  const employee=await prisma.employee.upsert({where:{employeeNo:'T-QA-001'},update:{},create:{employeeNo:'T-QA-001',name:'调模验收员',department:'生产部',team:'调模组'}});
  const admin=await prisma.user.update({where:{username:process.env.SEED_ADMIN_USERNAME||'tooling-admin'},data:{employeeId:employee.id,mustChangePassword:false}});
  for(const level of ['READ','COLLABORATE'] as const){const username='tooling-qa-'+level.toLowerCase();const e=await prisma.employee.upsert({where:{employeeNo:'T-QA-'+level},update:{},create:{employeeNo:'T-QA-'+level,name:level==='READ'?'只读验收员':'协同验收员',team:'调模组'}});const u=await prisma.user.upsert({where:{username},update:{},create:{username,passwordHash:await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD!,10),displayName:e.name,employeeId:e.id}});for(const scopeKey of ['MODULES:ON','MODULE:technology:'+level]){if(!await prisma.userAccessGrant.findFirst({where:{userId:u.id,scopeKey}}))await prisma.userAccessGrant.create({data:{userId:u.id,profile:'MODULE_ACCESS',grantType:scopeKey==='MODULES:ON'?'PRIMARY':'CONCURRENT',scopeKey}});}}
  const models=['03301220022','185212-2','SCN-001','170362-1'];const blades:TerminalToolingBlade[]=[];
  for(const [n,model] of models.entries()){const blade=await prisma.terminalToolingBlade.upsert({where:{normalizedKey:terminalToolingBladeKey(model,'QA 演示')},update:{},create:{model,manufacturer:'QA 演示',normalizedKey:terminalToolingBladeKey(model,'QA 演示'),compatiblePositions:[...TOOLING_POSITIONS],positionSpecs:{create:TOOLING_POSITIONS.map((position,i)=>({position,specification:i%2?'4.2×2.2':'2.7×2.4',dimensionA:i%2?4.2:2.7,dimensionB:i%2?2.2:2.4,dimensionUnit:'mm'}))}}});blades.push(blade);if(!blade.inventoryCountedAt&&n<3)await inventoryCommand(admin,{key:randomUUID(),action:'REGISTER',bladeId:blade.id,box:7+n,quantity:n===1?2:1,kind:'KIT'});}
  const terminal=await prisma.terminalToolingTerminal.upsert({where:{normalizedKey:terminalToolingTerminalKey('10023','QA 演示')},update:{},create:{specification:'10023',manufacturer:'QA 演示',wireRange:'0.5–0.75 mm²',normalizedKey:terminalToolingTerminalKey('10023','QA 演示')}});
  const contextKey=terminalToolingContextKey({wireRange:'0.5–0.75 mm²',equipment:'QA 压接机 A',mold:'M01'});
  if(!await prisma.terminalToolingSetup.findFirst({where:{terminalId:terminal.id}}))await prisma.terminalToolingSetup.create({data:{terminalId:terminal.id,name:'10023 · 标准组合',contextKey,version:1,status:'PUBLISHED',wireRange:'0.5–0.75 mm²',equipment:'QA 压接机 A',mold:'M01',publishedAt:new Date(),publishedBy:'验收数据',positions:{create:TOOLING_POSITIONS.map(position=>({position,bladeId:blades[0].id}))}}});
  if(!await prisma.toolingJob.findFirst({where:{actorId:admin.id}})){const startedAt=new Date(Date.now()-3600000),endedAt=new Date(+startedAt+1200000);await worklogCommand(admin,{key:randomUUID(),action:'BACKFILL',kind:'ASSIST',category:'刀片整理',description:'QA：整理刀片并核对盒号',startedAt:startedAt.toISOString(),endedAt:endedAt.toISOString(),reason:'本地验收示例'});}
  console.log('Isolated QA fixtures ready: admin + read/collaborate accounts, four blade models, recipe and assistance record. No production data modified.');
}
main().finally(()=>prisma.$disconnect());
