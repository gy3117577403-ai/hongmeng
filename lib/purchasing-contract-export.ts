import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { create as createFont } from 'fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { CONTRACT_FIELDS, clauseText, contractTax, rmbUpper, type ContractContent, type ContractDocument, type ContractLine } from './purchasing-contract';
import { pcMoney } from './purchasing-domain';

export type ContractPrint = {number:string;revision:number;documentStatus:string;document:ContractDocument};
const tableHeaders=['品名 / 品牌','规格型号','数量 / 单位','单价（元）','金额（元）','交期 / 备注'];
export function contractLineCells(l:ContractLine) {return [l.name+(l.brand?' / '+l.brand:''),l.spec,`${l.quantity} ${l.unit}`,l.unitPrice || '总额登记',pcMoney(l.amountCents),[l.deliveryDate,l.note].filter(Boolean).join('；')];}
export async function contractPdf(c:ContractPrint) {
  const pdf=await PDFDocument.create();
  pdf.registerFontkit({create(bytes){const font=createFont(Buffer.from(bytes));if(!('createSubset' in font))throw Error('Invalid CJK font');const create=font.createSubset.bind(font);font.createSubset=()=>{const subset=create();return Object.assign(subset,{encodeStream:()=>Readable.from([subset.encode()])});};return font as unknown as ReturnType<Parameters<PDFDocument['registerFontkit']>[0]['create']>;}});
  const font=await pdf.embedFont(await fs.readFile(path.join(process.cwd(),'public/fonts/NotoSansSC-Regular.otf')),{subset:true});
  const width=595.28,height=841.89,left=42,right=553.28,bottom=54;
  const {fields:f,clauses,lines,amountCents}=c.document;
  let page=pdf.addPage([width,height]), y=height-48;
  const wrap=(value:string,size:number,w=right-left)=>{const out:string[]=[];for(const paragraph of value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').split('\n')){let row='';for(const char of paragraph){if(row&&font.widthOfTextAtSize(row+char,size)>w){out.push(row);row=char;}else row+=char;}out.push(row);}return out;};
  const draw=(text:string,x:number,top:number,size=10)=>page.drawText(text,{x,y:top-size,font,size,color:rgb(.08,.08,.08)});
  const newPage=()=>{page=pdf.addPage([width,height]);y=height-45;draw(`${f.title} · ${c.number} · V${c.revision}${c.documentStatus==='DRAFT'?' · 草稿':''}`,left,y,9);y-=27;};
  const ensure=(h:number)=>{if(y-h<bottom)newPage();};
  const text=(value:string,size=10,gap=6)=>{for(const row of wrap(value,size)){ensure(size*1.55);draw(row,left,y,size);y-=size*1.55;}y-=gap;};
  const heading=(value:string)=>{ensure(52);text(value,12,6);};
  text(f.purchaser,12,7);text(f.title+(c.documentStatus==='DRAFT'?'（草稿）':''),20,12);
  text(`合同编号：${c.number}    版本：${c.revision}    签订日期：${f.date || '待填写'}`);
  text(`签订地点：${f.signingPlace || '待填写'}`);
  for(const prefix of ['purchaser','supplier'] as const) {
    heading(prefix==='purchaser'?'需方信息':'供方信息');
    text(`${f[prefix]}\n统一社会信用代码：${f[`${prefix}TaxId`] || '待填写'}\n地址：${f[`${prefix}Address`] || '待填写'}\n联系人：${f[`${prefix}Contact`] || '待填写'}    电话：${f[`${prefix}Phone`] || '待填写'}`);
  }
  heading('采购明细');
  const cols=[100,122,60,70,72,87.28],size=8;
  const row=(values:string[],header=false)=>{
    const wrapped=values.map((v,i)=>wrap(v,size,cols[i]-10));
    const h=Math.max(...wrapped.map(v=>v.length))*12+14;
    if(y-h<bottom){newPage();if(!header)row(tableHeaders,true);}
    let x=left;
    values.forEach((_,i)=>{page.drawRectangle({x,y:y-h,width:cols[i],height:h,borderWidth:.5,borderColor:rgb(.4,.4,.4),...(header?{color:rgb(.95,.95,.95)}:{})});wrapped[i].forEach((v,j)=>draw(v,x+5,y-6-j*12,size));x+=cols[i];});y-=h;
  };
  row(tableHeaders,true);lines.forEach(l=>row(contractLineCells(l)));y-=12;
  text(`合同含税总额：${pcMoney(amountCents)}    大写：${rmbUpper(amountCents)}`,11);
  const tax=contractTax(amountCents,f.taxRate);if(tax)text(`税率：${f.taxRate}%    不含税金额：${pcMoney(tax.netCents)}    税额：${pcMoney(tax.taxCents)}`);
  if(lines.some(l=>(l.freightCents||0)||(l.discountCents||0)))text(`上述行金额包含登记的运费及优惠；运费合计 ${pcMoney(lines.reduce((n,l)=>n+(l.freightCents||0),0))}，优惠合计 ${pcMoney(lines.reduce((n,l)=>n+(l.discountCents||0),0))}。`);
  for(const clause of clauses){heading(clause.title);text(clauseText(clause.body,f));}
  if(f.specialTerms){heading('特别约定');text(f.specialTerms);}
  const signLeft=wrap(`需方：${f.purchaser}`,10,240),signRight=wrap(`供方：${f.supplier}`,10,240);
  ensure(Math.max(signLeft.length,signRight.length)*16+125);y-=15;
  signLeft.forEach((v,i)=>draw(v,left,y-i*16));signRight.forEach((v,i)=>draw(v,310,y-i*16));
  y-=Math.max(signLeft.length,signRight.length)*16+25;
  for(const label of ['签字并盖章：','授权代表：','签订日期：']){draw(label,left,y);draw(label,310,y);y-=28;}
  const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`合同 ${c.number} · V${c.revision}    第 ${i+1} / ${pages.length} 页`,{x:left,y:28,font,size:8,color:rgb(.4,.4,.4)}));
  pdf.setTitle(`${c.number}-V${c.revision}-${f.title}`);pdf.setAuthor(f.purchaser);pdf.setCreator('杭连采购');
  return Buffer.from(await pdf.save());
}
export function contractWorkbook(content:ContractContent, print?:ContractPrint) {
  const book=new ExcelJS.Workbook();book.creator='杭连采购';
  const sheet=book.addWorksheet(print?'采购合同':'合同模板',{pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.3,right:.3,top:.4,bottom:.4,header:.2,footer:.2}}});
  sheet.columns=[{width:22},{width:28},{width:12},{width:15},{width:18},{width:24}];
  const full=(value:string,bold=false)=>{const r=sheet.addRow([value]);sheet.mergeCells(r.number,1,r.number,6);r.font={name:'Microsoft YaHei',size:bold?13:11,bold};r.alignment={vertical:'top',wrapText:true};r.height=Math.max(24,(value.split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(s.length/55)),0))*17);return r;};
  full(content.fields.purchaser,true);full(content.fields.title+(print?.documentStatus==='DRAFT'?'（草稿）':''),true);
  if(print)full(`合同编号：${print.number}    V${print.revision}    签订日期：${content.fields.date}`);
  for(const [key,label] of CONTRACT_FIELDS.filter(([key])=>!['title','specialTerms'].includes(key)))full(`${label}：${content.fields[key]}`);
  if(print){const h=sheet.addRow(tableHeaders);h.font={bold:true,name:'Microsoft YaHei',size:10};h.height=28;sheet.pageSetup.printTitlesRow=`${h.number}:${h.number}`;
    for(const l of print.document.lines){const r=sheet.addRow(contractLineCells(l));r.alignment={wrapText:true,vertical:'top'};r.height=Math.max(30,...contractLineCells(l).map(v=>Math.ceil(v.length/12)*16));}
    full(`含税合计：${pcMoney(print.document.amountCents)}    大写：${rmbUpper(print.document.amountCents)}`,true);
    const tax=contractTax(print.document.amountCents,content.fields.taxRate);if(tax)full(`税率：${content.fields.taxRate}%    不含税金额：${pcMoney(tax.netCents)}    税额：${pcMoney(tax.taxCents)}`);
    if(print.document.lines.some(l=>(l.freightCents||0)||(l.discountCents||0)))full(`上述行金额包含运费及优惠；运费合计 ${pcMoney(print.document.lines.reduce((n,l)=>n+(l.freightCents||0),0))}，优惠合计 ${pcMoney(print.document.lines.reduce((n,l)=>n+(l.discountCents||0),0))}。`);
  }
  for(const c of content.clauses){full(c.title,true);full(print?clauseText(c.body,content.fields):c.body);}
  if(content.fields.specialTerms){full('特别约定',true);full(content.fields.specialTerms);}
  full(`需方：${content.fields.purchaser}\n签字并盖章：\n授权代表：\n日期：\n\n供方：${content.fields.supplier}\n签字并盖章：\n授权代表：\n日期：`);
  sheet.headerFooter.oddFooter='第 &P 页 / 共 &N 页';
  return book;
}
