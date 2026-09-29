const {PrismaClient}=require('@prisma/client');
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
const {PDFDocument,StandardFonts,rgb}=require('pdf-lib');
const {randomUUID,createHash}=require('node:crypto');
const {mkdirSync,writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
const ExcelJS=require('exceljs');
const bcrypt=require('bcryptjs');
if(process.env.IMPORT_QA_ALLOW!=='disposable-import-runtime'||!['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))throw Error('Disposable loopback database required');
const db=new PrismaClient();
(async()=>{
  const marker='import-qa-'+randomUUID().slice(0,8),customer='导入验收客户-'+marker,password='Import-Acceptance-2026!Z',users={};
  for(const [role,grants] of [['plan',['MODULE:production:COLLABORATE']],['reader',['MODULE:production:READ']],['tech',['MODULE:technology:COLLABORATE']]]) {
    const user=await db.user.create({data:{username:marker+'-'+role,displayName:'导入验收-'+role,passwordHash:await bcrypt.hash(password,10),laborRole:'EMPLOYEE',accountStatus:'ACTIVE',isActive:true,mustChangePassword:false,accessGrants:{create:['MODULES:ON',...grants].map(scopeKey=>({profile:'MODULE_ACCESS',scopeKey}))}}});users[role]={id:user.id,username:user.username};
  }
  const specs=['D010240-8417-V01','GRQ05-Estop-V1','CF-122-0038-00','GHXS-JZGX-0024','D010240-8417-V02'];
  const products=[];
  for(const [i,spec] of specs.entries()) {
    if(i===1||i===4)continue;
    products.push(await db.drawingLibraryItem.create({data:{libraryKey:marker+'-'+i,customerName:customer+'(10001)',customerCode:'10001',productName:'验收线束',specification:spec,fixtureRequired:i===0?true:i===2?false:null}}));
  }
  const ambiguous=await db.drawingLibraryItem.create({data:{libraryKey:marker+'-legacy',customerName:customer,productName:'历史线束',specification:specs[3]}});
  await db.drawingLibraryItem.create({data:{libraryKey:marker+'-similar',customerName:customer,specification:'D010240-8417-V09',productName:'相似规格仅供查看'}});
  const foreign=await db.drawingLibraryItem.create({data:{libraryKey:marker+'-foreign',customerName:'其他验收客户-'+marker,specification:specs[0]}});
  const removed=await db.drawingLibraryItem.create({data:{libraryKey:marker+'-removed',customerName:customer,specification:'REMOVED',deletedAt:new Date()}});
  const pdf=await PDFDocument.create(),page=pdf.addPage([595,842]),font=await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('IMPORT DRAWING VERIFICATION', {x:45,y:770,size:21,font,color:rgb(.12,.22,.33)});
  page.drawText(specs[0],{x:45,y:732,size:17,font});page.drawRectangle({x:70,y:440,width:455,height:180,borderWidth:2,borderColor:rgb(.3,.5,.6)});
  page.drawText('Controlled drawing and SOP / test fixture', {x:45,y:390,size:13,font});
  const bytes=Buffer.from(await pdf.save()),sha=createHash('sha256').update(bytes).digest('hex'),files=[];
  const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'auto',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
  for(const code of ['drawing','sop','sop']) {
    const category=await db.resourceCategory.findUniqueOrThrow({where:{code}}),key=marker+'/'+files.length+'.pdf';
    await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:key,Body:bytes,ContentType:'application/pdf'}));
    files.push(await db.drawingLibraryFile.create({data:{libraryItemId:products[0].id,categoryId:category.id,originalName:`${specs[0]}-${code}-${files.length}.pdf`,version:'V1.0',mimeType:'application/pdf',size:bytes.length,sha256:sha,objectKey:key,uploadedById:users.tech.id}}));
  }
  const now=new Date(Date.now()+8*3600000),day=now.toISOString().slice(0,10),weekDate=new Date(day);weekDate.setUTCDate(weekDate.getUTCDate()-(weekDate.getUTCDay()+6)%7);const week=weekDate.toISOString().slice(0,10),due=new Date(now.getTime()+20*86400000).toISOString().slice(0,10);
  const oldOrder=await db.productionPlanOrder.create({data:{sourceOrderNo:marker+'-old',sourceLineNo:1,customerName:customer,productName:'原订单',specification:specs[0],drawingLibraryItemId:products[0].id,orderQuantity:100,planningUnitMilliseconds:90000,orderDate:new Date('2026-01-01'),customerDueDate:new Date(due),status:'open',createdById:users.plan.id}});
  const dir=process.env.IMPORT_QA_OUTPUT||'output/playwright/import-association';mkdirSync(dir,{recursive:true});
  const mass=new ExcelJS.Workbook(),tab=mass.addWorksheet('量产计划');tab.addRow(['订单日期','客户名称','产品名称','型号/规格','订单总量','本周排产量','单件计划工时（分钟）','客户交期']);
  for(let i=0;i<16;i++)tab.addRow([day,customer,'验收线束',specs[i]||'QA-CABLE-'+(i+1),30,30,i===2?'':10,due]);
  const massPath=resolve(dir,'mass-plan.xlsx');await mass.xlsx.writeFile(massPath);
  const sample=new ExcelJS.Workbook(),st=sample.addWorksheet('样品计划');st.addRow(['客户名称','产品名称','型号/规格','客户等级','样品数量','计划日期','单套计划工时（分钟/套）','样品类型（选填）']);
  st.addRow([customer,'验收线束',specs[0],'A',5,due,12.5,'新品试制']);st.addRow([customer,'新样品','QA-SAMPLE-NEW','B',3,due,'','老产品制作']);
  const samplePath=resolve(dir,'sample-plan.xlsx');await sample.xlsx.writeFile(samplePath);
  const result={marker,customer,password,users,products,ambiguous,foreign,removed,files,specs,week,due,day,massPath,samplePath,oldOrderId:oldOrder.id};
  writeFileSync(resolve(dir,'fixture.json'),JSON.stringify(result));console.log(JSON.stringify({dir,marker}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.$disconnect());
