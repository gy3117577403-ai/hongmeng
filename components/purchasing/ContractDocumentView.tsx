import { clauseText, contractTax, rmbUpper, type ContractDocument } from '@/lib/purchasing-contract';
import { pcMoney } from '@/lib/purchasing-domain';
export default function ContractDocumentView({document:d,number='',revision=1,status='DRAFT'}:{document:ContractDocument;number?:string;revision?:number;status?:string}) {
  const f=d.fields,tax=contractTax(d.amountCents,f.taxRate);
  return <article className="contract-page contract-formal">
    <p className="contract-company">{f.purchaser}</p><h1>{f.title}{status==='DRAFT'?'（草稿）':''}</h1>
    <div className="contract-meta"><span>合同编号：{number||'待填写'}　V{revision}</span><span>日期：{f.date||'待填写'}　签订地点：{f.signingPlace||'待填写'}</span></div>
    <div className="contract-parties">{(['purchaser','supplier'] as const).map(p=><div key={p}><b>{p==='purchaser'?'需方':'供方'}：{f[p]||'待填写'}</b><p>统一社会信用代码：{f[`${p}TaxId`]||'待填写'}<br/>地址：{f[`${p}Address`]||'待填写'}<br/>联系人：{f[`${p}Contact`]||'待填写'}<br/>电话：{f[`${p}Phone`]||'待填写'}</p></div>)}</div>
    <table><thead><tr>{['品名 / 品牌','规格型号','数量 / 单位','单价（元）','金额（元）','交期 / 备注'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{d.lines.map(l=><tr key={l.id}><td>{l.name}{l.brand&&<small>{l.brand}</small>}</td><td>{l.spec}</td><td>{l.quantity} {l.unit}</td><td>{l.unitPrice||'总额登记'}</td><td>{pcMoney(l.amountCents)}{l.estimated&&<small>预估</small>}</td><td>{l.deliveryDate}<br/>{l.note}</td></tr>)}</tbody></table>
    <p><b>合同含税总额：{pcMoney(d.amountCents)}　大写：{rmbUpper(d.amountCents)}</b><br/>{tax&&<>税率：{f.taxRate}%　不含税金额：{pcMoney(tax.netCents)}　税额：{pcMoney(tax.taxCents)}</>}</p>
    {d.lines.some(l=>(l.freightCents||0)||(l.discountCents||0))&&<p>上述行金额包含登记的运费及优惠；运费合计 {pcMoney(d.lines.reduce((n,l)=>n+(l.freightCents||0),0))}，优惠合计 {pcMoney(d.lines.reduce((n,l)=>n+(l.discountCents||0),0))}。</p>}
    {d.clauses.map(c=><section key={c.id} className="contract-clause"><h2>{c.title}</h2><p>{clauseText(c.body,f)}</p></section>)}
    {f.specialTerms&&<section className="contract-clause"><h2>特别约定</h2><p>{f.specialTerms}</p></section>}
    <div className="contract-sign"><div>需方：{f.purchaser}<p>签字并盖章：<br/><br/>授权代表：<br/>日期：</p></div><div>供方：{f.supplier}<p>签字并盖章：<br/><br/>授权代表：<br/>日期：</p></div></div>
  </article>;
}
