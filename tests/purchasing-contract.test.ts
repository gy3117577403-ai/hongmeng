import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { defaultContractContent, contractContent, contractProblems, contractTax, rmbUpper, clauseText, type ContractDocument } from '../lib/purchasing-contract';
import { contractWorkbook, contractPdf } from '../lib/purchasing-contract-export';

test('corporate contract defaults retain confirmed purchaser and require actual commercial terms', () => {
  const content=defaultContractContent();
  assert.equal(content.fields.purchaser,'杭州杭连电子有限公司');
  assert.equal(content.fields.date,'');assert.equal(content.fields.taxRate,'');assert.equal(content.fields.paymentTerms,'');
  assert.ok(contractProblems(content,[]).includes('采购明细' as any));
  assert.match(clauseText('{{paymentTerms}}',content.fields),/待填写/);
  assert.throws(()=>contractContent({...content,clauses:[{id:'a',title:'a',body:'{{unknownField}}'}]}),/未知字段/);
  assert.throws(()=>contractContent({...content,fields:{...content.fields,date:'2026-02-30'}}),/日期/);
  assert.throws(()=>contractContent({...content,fields:{...content.fields,taxRate:'-13'}}),/税率/);
  assert.throws(()=>contractContent({...content,clauses:[content.clauses[0],content.clauses[0]]}),/重复/);
  assert.equal(contractContent(content).clauses.length,10);
});
test('RMB uppercase and inclusive VAT preserve cents across zero and grouped amounts',()=>{
  const cases:[[number,string],...[number,string][]]=[[0,'零元整'],[1,'零元壹分'],[10,'零元壹角'],[101,'壹元零壹分'],[100100,'壹仟零壹元整'],[1000000,'壹万元整'],[100010001,'壹佰万零壹佰元零壹分'],[10000000100,'壹亿零壹元整']];
  for(const [amount,expected] of cases)assert.equal(rmbUpper(amount),expected);
  assert.deepEqual(contractTax(11300,'13'),{netCents:10000,taxCents:1300});
  assert.deepEqual(contractTax(1,'13'),{netCents:1,taxCents:0});
  assert.deepEqual(contractTax(10555,'0'),{netCents:10555,taxCents:0});
  assert.equal(contractTax(100,''),null);assert.throws(()=>rmbUpper(-1));
});
test('long contract exports contain all lines, editable literal text and valid multipage CJK PDF',async()=>{
  const content=defaultContractContent();content.fields.supplier='隔离导出供应商';content.fields.taxRate='13';
  content.fields.specialTerms='=测试文字不会作为公式执行';
  const document:ContractDocument={...content,schemaVersion:1,amountCents:40*11300,lines:Array.from({length:40},(_,i)=>({id:String(i),number:String(i),name:`连接器-${i}`,spec:'M8技术规格'.repeat(5),quantity:2,unit:'件',amountCents:11300,unitPrice:'56.50',brand:'测试品牌',deliveryDate:'按合同约定',note:'需核对品牌型号及随货技术资料'}))};
  const print={number:'QA-EXPORT',revision:2,documentStatus:'DRAFT',document};
  const book=contractWorkbook(content,print);const data=await book.xlsx.writeBuffer();assert.ok(data.byteLength>1000);
  const rows=book.worksheets[0].getRows(1,book.worksheets[0].rowCount)!;
  assert.equal(rows.filter(r=>String(r.getCell(1).value).startsWith('连接器-')).length,40);
  assert.ok(rows.some(r=>r.getCell(1).value===content.fields.specialTerms));
  const bytes=await contractPdf(print),pdf=await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>=4);assert.equal(pdf.getTitle(),'QA-EXPORT-V2-采购合同');
  assert.ok(bytes.length>20000);
});
