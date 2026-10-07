import {writeFileSync, readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import sharp from 'sharp';
import {prisma} from '../lib/prisma';
import {poolCommand,loadOrderPool} from '../lib/order-pool-service';
import {mutateMaterialOrder,readMaterialOrder} from '../lib/material-order-service';
import {putObject} from '../lib/s3';
if(process.env.ORDER_POOL_QA_ALLOW!=='disposable-order-pool')throw Error('Disposable runtime required');
const db=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
if(!['127.0.0.1','localhost'].includes(db.hostname)||!/_ci$/.test(db.pathname))throw Error('Disposable local CI database required');
async function main(){
 const marker='pool-qa-'+randomUUID().slice(0,8),password='Disposable-Pool-2026!A',users:Record<string,any>={};
 for(const [name,displayName,scope] of [['admin','计划员','ADMIN_GLOBAL'],['planner','计划协同员','production'],['warehouse','仓库员','materials'],['technician','技术员','technology'],['reader','只读员工','production']]){
  const u=await prisma.user.create({data:{username:marker+'-'+name,passwordHash:await bcrypt.hash(password,10),displayName,isActive:true,accountStatus:'ACTIVE',mustChangePassword:false,accessGrants:{create:scope==='ADMIN_GLOBAL'?[{profile:'ADMIN_GLOBAL',scopeKey:'GLOBAL',grantType:'PRIMARY'}]:[{profile:'MODULE_ACCESS',scopeKey:'MODULES:ON',grantType:'PRIMARY'},{profile:'MODULE_ACCESS',scopeKey:'MODULE:'+scope+':'+(name==='reader'?'READ':'COLLABORATE'),grantType:'CONCURRENT'}]}}});
  users[name]={id:u.id,username:u.username};
 }
 const ids:string[]=[];
 const models=['GRQ05-Estop-V1','CF-12-0038-00','D014503-8301-V02','WH-P05-DRV-2-FR','1241380-1端子线150mm','P75混动箱低压线束','G09-13-YH-V1','EXS-E75060C0330SAIC-G05'];
 for(let i=0;i<models.length;i++){
  const result=await poolCommand({action:'create',requestKey:randomUUID(),row:{sourceOrderNo:marker+'-'+i,sourceLineNo:1,customerName:i%2?'杭州昆泰':'伽利略（天津）',productName:'线束',specification:models[i],orderQuantity:100+i*20,unitMinutes:3+i*0.5,priority:i===0?'insert':i<3?'urgent':'normal',note:i===0?'先准备首批 40 套':i===1?'客户交期待确认，先准备技术资料':''}},users.admin.id) as any;
  ids.push(result.ids[0]);
 }
 const q=await loadOrderPool(new URLSearchParams({q:marker}));
 const first=q.orders.find(o=>o.id===ids[0])!,second=q.orders.find(o=>o.id===ids[1])!;
 let m=await readMaterialOrder(second.warehouseTaskId!);
 await mutateMaterialOrder(m.id,{action:'report_exception',requestKey:randomUUID(),version:m.version,materialModel:'DJ7061Y-89直扣',supplySource:'CUSTOMER',shortageQuantity:20,exceptionType:'shortage',unit:'个'},users.warehouse.id,true);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['订单号','行号','客户','规格','订单数量','客户交期','单套工时(分钟)'],[marker+'-import',1,'杭州昆泰','POOL-IMPORT-01',60,'',1.5],[marker+'-invalid',1,'杭州昆泰','POOL-INVALID',-2,'',1]]),'订单池');XLSX.writeFile(book,'/tmp/order-pool-import.xlsx');
 await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/><rect x="32" y="32" width="1136" height="736" fill="none" stroke="#233b52" stroke-width="2"/><text x="70" y="94" font-family="sans-serif" font-size="26" fill="#233b52">GRQ05-Estop-V1 / ORDER POOL QA DRAWING</text><text x="70" y="133" font-family="sans-serif" font-size="15" fill="#788a9d">Disposable acceptance fixture - no production technical data</text><path d="M260 330 H930 M260 380 H930 M260 430 H930" fill="none" stroke="#233b52" stroke-width="8"/><rect x="160" y="270" width="100" height="220" rx="12" fill="#eef3f7" stroke="#233b52" stroke-width="3"/><rect x="930" y="270" width="100" height="220" rx="12" fill="#eef3f7" stroke="#233b52" stroke-width="3"/><path d="M260 540 V580 H930 V540" fill="none" stroke="#788a9d" stroke-width="2"/><text x="540" y="568" font-family="sans-serif" font-size="24" fill="#233b52">1000 mm</text><path d="M32 650 H1168 M760 650 V768" stroke="#233b52" stroke-width="2"/><text x="65" y="700" font-family="sans-serif" font-size="21" fill="#233b52">HARNESS - PREPARATION REFERENCE</text><text x="795" y="700" font-family="sans-serif" font-size="20" fill="#233b52">REV A / SHEET 1 OF 1</text></svg>`)).png().toFile('/tmp/order-pool-upload.png');
 const drawingCustomer='伽利略（天津）',drawingSpec='GRQ20-LIDARB-V1',archives=[];
 const category=await prisma.resourceCategory.findFirstOrThrow({where:{code:'drawing'}});
 const image=readFileSync('/tmp/order-pool-upload.png');
 for(const variant of ['A','B']){
  const item=await prisma.drawingLibraryItem.create({data:{customerName:drawingCustomer,specification:drawingSpec,productName:variant==='A'?'激光雷达线后（禾赛）':'激光雷达线后（确认版）',libraryKey:marker+'-ARCHIVE-'+variant}});
  const objectKey=marker+'/archive-'+variant+'.png';await putObject({key:objectKey,body:image,contentType:'image/png',originalName:'原图-'+variant+'.png'});
  const file=await prisma.drawingLibraryFile.create({data:{libraryItemId:item.id,categoryId:category.id,originalName:'原图-'+variant+'.png',mimeType:'image/png',size:image.length,objectKey,version:variant==='A'?'V1.0':'V1.1'}});
  archives.push({...item,fileId:file.id});
 }
 await prisma.drawingLibraryItem.create({data:{customerName:drawingCustomer,specification:'POOL-TRASH-ONLY',libraryKey:marker+'-TRASH',deletedAt:new Date()}});
 const associationBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(associationBook,XLSX.utils.aoa_to_sheet([['订单号','行号','客户','规格','订单数量'],[marker+'-assoc-import-1',1,drawingCustomer,drawingSpec,50],[marker+'-assoc-import-2',1,drawingCustomer,drawingSpec,60]]),'订单池');XLSX.writeFile(associationBook,'/tmp/order-pool-association-import.xlsx');
 return{marker,password,users,first,second,currentWeek:q.currentWeek,ids,importFile:'/tmp/order-pool-import.xlsx',uploadFile:'/tmp/order-pool-upload.png',drawingCustomer,drawingSpec,archives,associationFile:'/tmp/order-pool-association-import.xlsx'};
}
main().then(f=>console.log(JSON.stringify(f))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());
