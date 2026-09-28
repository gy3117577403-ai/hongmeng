import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import {prisma} from '../lib/prisma';
import {poolCommand,loadOrderPool} from '../lib/order-pool-service';
import {mutateMaterialOrder,readMaterialOrder} from '../lib/material-order-service';
if(process.env.ORDER_POOL_QA_ALLOW!=='disposable-order-pool')throw Error('Disposable runtime required');
const db=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
if(!['127.0.0.1','localhost'].includes(db.hostname)||!/_ci$/.test(db.pathname))throw Error('Disposable local CI database required');
async function main(){
 const marker='pool-qa-'+randomUUID().slice(0,8),password='Disposable-Pool-2026!A',users:Record<string,any>={};
 for(const [name,displayName,scope] of [['admin','计划员','ADMIN_GLOBAL'],['warehouse','仓库员','materials'],['technician','技术员','technology'],['reader','只读员工','production']]){
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
 writeFileSync('/tmp/order-pool-upload.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5asAAAAASUVORK5CYII=','base64'));
 return{marker,password,users,first,second,currentWeek:q.currentWeek,ids,importFile:'/tmp/order-pool-import.xlsx',uploadFile:'/tmp/order-pool-upload.png'};
}
main().then(f=>console.log(JSON.stringify(f))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>prisma.$disconnect());

