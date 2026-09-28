import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { previewPoolRows, type PoolInputRow } from '@/lib/order-pool-service';
import { PoolError } from '@/lib/order-pool-domain';
export const dynamic='force-dynamic';
const columns: { [key:string]:string[] }={sourceOrderNo:['订单号','订单编号','源订单号'],sourceLineNo:['行号','订单行号'],customerName:['客户','客户名称'],productName:['品名','产品名称'],specification:['规格','型号','品番','产品规格'],orderQuantity:['订单数量','数量'],orderDate:['下单日期','订单日期'],customerDueDate:['客户交期','交期'],unitMinutes:['单套工时(分钟)','单套工时（分钟）','单套工时','单件工时'],preparationQuantity:['准备数量','备料数量'],preparationDueAt:['准备完成日期','准备交期'],remark:['备注']};
export async function GET() {
  try { await requireUser(); const book=XLSX.utils.book_new(); const sheet=XLSX.utils.aoa_to_sheet([Object.values(columns).map(a=>a[0])]); sheet['!cols']=Object.keys(columns).map(()=>({wch:22})); XLSX.utils.book_append_sheet(book,sheet,'订单池'); const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});return new NextResponse(bytes,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('订单池导入模板.xlsx')}}); }
  catch(e){if(e instanceof UnauthorizedError)return unauthorized();throw e;}
}
export async function POST(req:NextRequest) {
  try { await requireUser(); const form=await req.formData(),file=form.get('file'); if(!(file instanceof File)||file.size>10*1024*1024)throw new PoolError('请选择 10MB 以内的 Excel 或 CSV');if(!/\.(xlsx|xls|csv)$/i.test(file.name))throw new PoolError('仅支持 Excel 或 CSV');const bytes=Buffer.from(await file.arrayBuffer());
    const book=XLSX.read(bytes,{type:'buffer',cellDates:true});const sheet=book.Sheets[book.SheetNames[0]];if(!sheet)throw new PoolError('文件中没有工作表');
    const grid=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:''});const index=grid.slice(0,20).findIndex(row=>Object.values(columns).slice(2,3).every(names=>row.some(c=>names.includes(String(c).trim()))));if(index<0)throw new PoolError('找不到客户、规格和订单数量表头，请使用订单池模板');
    const headers=grid[index].map(c=>String(c).trim()),map=Object.entries(columns).map(([key,names])=>[key,headers.findIndex(h=>names.includes(h))] as const);
    for(const required of ['customerName','specification','orderQuantity'])if(map.find(([k])=>k===required)?.[1]===-1)throw new PoolError('缺少客户、规格或订单数量列');
    const rows=grid.slice(index+1).filter(row=>row.some(c=>c!==''&&c!=null)).map(row=>Object.fromEntries(map.map(([k,i])=>{let value=i<0?'':row[i];if(value instanceof Date)value=value.toISOString().slice(0,10);return[k,value];})) as PoolInputRow);
    const fingerprint=createHash('sha256').update(bytes).digest('hex');return NextResponse.json({ok:true,rows:await previewPoolRows(rows,fingerprint),fingerprint,fileName:file.name});
  }catch(e){if(e instanceof UnauthorizedError)return unauthorized();return NextResponse.json({ok:false,error:e instanceof Error?e.message:'导入解析失败'},{status:e instanceof PoolError?e.status:400});}
}
