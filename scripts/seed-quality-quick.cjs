const fs=require('node:fs'), {PrismaClient}=require('@prisma/client'),{randomUUID}=require('node:crypto'),bcrypt=require('bcryptjs');
if(!/^postgresql:\/\/[^@]+@127\.0\.0\.1:55453\/hongmeng_quality_quick_v134153(_release)?\?/.test(process.env.DATABASE_URL||''))throw Error('Dedicated quality quick database required');
const db=new PrismaClient();
async function main(){
  const marker='QQQA-'+randomUUID().slice(0,7),password=process.env.OTHER_HOURS_QA_PASSWORD||'Quick-'+randomUUID()+'!9',users={};
  for(const [kind,profile,name] of [['admin','ADMIN_GLOBAL','快处验收管理员'],['quality','QUALITY_REVIEWER','品质专员'],['employee','FIELD_REPORTER','装配员工']]) {
    const employee=await db.employee.create({data:{employeeNo:marker+'-'+kind,name,department:kind==='employee'?'装配':'品质'}});
    const u=await db.user.create({data:{username:marker+'-'+kind,passwordHash:await bcrypt.hash(password,10),displayName:name,laborRole:kind==='admin'?'ADMIN':'EMPLOYEE',employeeId:employee.id,mustChangePassword:false,isActive:true,accountStatus:'ACTIVE',accessGrants:{create:{profile,scopeKey:'GLOBAL'}}}});
    users[kind]={id:u.id,username:u.username,employeeId:employee.id};
  }
  const product=await db.drawingLibraryItem.create({data:{customerName:'快处验收客户',productName:'端子连接线束',specification:'HL-2609-153',libraryKey:marker}});
  const orders=[];
  for(let n=1;n<=3;n++){
    const o=await db.workOrder.create({data:{code:marker+'-WO-'+n,businessCode:marker+'-'+n,customerName:product.customerName,productName:product.productName,specification:product.specification,stage:'frontend',drawingLibraryItemId:n===3?null:product.id,qrTicket:{create:{publicCode:randomUUID().replaceAll('-','')}}},include:{qrTicket:true}});
    orders.push({id:o.id,code:o.code,businessCode:o.businessCode,publicCode:o.qrTicket.publicCode});
  }
  const fixture={marker,password,users,product,orders};fs.mkdirSync('.docker',{recursive:true});fs.writeFileSync('.docker/quick-fixture.json',JSON.stringify(fixture,null,2));console.log(JSON.stringify({ok:true,marker,orders:orders.map(o=>o.code)}));
}
main().finally(()=>db.$disconnect());
