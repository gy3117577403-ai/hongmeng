const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
async function main(){
 const username=process.env.SEED_ADMIN_USERNAME||'admin'; const password=process.env.SEED_ADMIN_PASSWORD||'123'; const reset=process.env.SEED_RESET_ADMIN_PASSWORD==='true'; const passwordHash=await bcrypt.hash(password,10);
 const old=await prisma.user.findUnique({where:{username}}); if(!old){await prisma.user.create({data:{username,passwordHash,displayName:'管理员',isActive:true}}); console.log('created admin');} else if(reset){await prisma.user.update({where:{username},data:{passwordHash,isActive:true}}); console.log('reset admin');}
 const cats=[['原图','drawing',1],['SOP指导书','sop',2],['成品图','product',3],['辅料规格','material',4],['注意事项','notice',5]];
 for(const [name,code,sortOrder] of cats){await prisma.resourceCategory.upsert({where:{code},create:{name,code,sortOrder},update:{name,sortOrder}})}
 const orders=[['WO-20250520-001','新能源电池线束总成','frontend',75,'urgent','processing'],['WO-20250520-002','车门线束（左前门）','backend',40,'high','processing'],['WO-20250520-003','座椅线束总成','not_issued',0,'normal','pending'],['WO-20250519-008','仪表台线束总成','backend',60,'high','processing'],['WO-20250518-007','发动机线束总成','frontend',90,'urgent','processing'],['WO-20250518-006','尾门线束总成','not_issued',0,'normal','pending']];
 for(const [code,productName,stage,progress,priority,status] of orders){
  const exists=await prisma.workOrder.findUnique({where:{code}});
  if(!exists) await prisma.workOrder.create({data:{code,productName,stage,progress,priority,status}});
 }
 console.log('seed completed');
}
main().catch(e=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());
