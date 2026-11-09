import { PurchasingError } from './purchasing-domain';

export const CONTRACT_FIELDS = [
  ['title', '合同标题'], ['purchaser', '需方全称'], ['purchaserTaxId', '需方统一社会信用代码'],
  ['purchaserAddress', '需方公司地址'], ['purchaserContact', '需方联系人'], ['purchaserPhone', '需方电话'],
  ['supplier', '供方全称'], ['supplierTaxId', '供方统一社会信用代码'], ['supplierAddress', '供方地址'],
  ['supplierContact', '供方联系人'], ['supplierPhone', '供方电话'], ['date', '签订日期'], ['signingPlace', '签订地点'],
  ['deliveryAddress', '收货地址'], ['deliveryDate', '交货日期 / 交期约定'], ['shippingTerms', '运输、包装及费用承担'],
  ['qualityStandard', '质量标准及技术附件'], ['inspectionPeriod', '验收期限'], ['warrantyPeriod', '质保期限'],
  ['refundPeriod', '退款期限'], ['paymentTerms', '付款方式及期限'], ['taxRate', '增值税税率（%）'],
  ['invoiceType', '发票类型'], ['invoiceDeadline', '开票期限'], ['payee', '供方收款单位'],
  ['bank', '供方开户银行'], ['account', '供方收款账号'], ['refundAccount', '需方指定退款账户'],
  ['dispute', '争议解决约定'], ['specialTerms', '特别约定'],
] as const;
export type ContractField = typeof CONTRACT_FIELDS[number][0];
export type ContractClause = { id: string; title: string; body: string };
export type ContractContent = { fields: Record<ContractField, string>; clauses: ContractClause[] };
export type ContractLine = { id: string; number: string; name: string; spec: string; quantity: number; unit: string; amountCents: number;
  unitPrice?: string | null; freightCents?: number; discountCents?: number; estimated?: boolean; brand?: string; deliveryDate?: string; note?: string };
export type ContractDocument = ContractContent & { schemaVersion: 1; lines: ContractLine[]; amountCents: number };
const blankFields = Object.fromEntries(CONTRACT_FIELDS.map(([key]) => [key, ''])) as Record<ContractField,string>;
export function defaultContractContent(): ContractContent {
  return { fields: { ...blankFields, title: '采购合同', purchaser: '杭州杭连电子有限公司',
    purchaserAddress: '浙江省杭州市临平区星桥街道星星路7号1幢202', purchaserContact: '贾改真', purchaserPhone: '0571-86169376 / 0571-86166795',
    deliveryAddress: '浙江省杭州市临平区星桥街道星发街17号2号楼3楼', signingPlace: '浙江省杭州市',
    shippingTerms: '供方负责送达需方指定收货地点并承担运输费用。包装应适合运输和储存，随货提供送货单及约定的合格证明、检测报告等资料。',
    qualityStandard: '按双方确认的品牌、规格型号、原厂产品数据手册及本合同技术附件执行。供方保证来源合法、原装正品，未经需方书面同意不得替换品牌、型号或材料。',
    dispute: '双方先协商解决；协商不成的，向合同签订时需方住所地有管辖权的人民法院提起诉讼。' }, clauses: [
    { id: 'goods', title: '一、采购标的与价款', body: '产品名称、品牌、规格型号、数量、单价及交期以本合同明细为准。合同金额以人民币计价，为含税金额，运输等费用按本合同约定执行。未经双方书面确认，不得单方变更价格、数量或产品要求。' },
    { id: 'quality', title: '二、质量保证与技术要求', body: '{{qualityStandard}}\n供方应提供可追溯的产品信息及必要的质量文件。对生产批次、生产日期及保质期限有特殊要求的，应在明细或技术附件中列明。' },
    { id: 'delivery', title: '三、交货、包装及风险承担', body: '交货日期：{{deliveryDate}}。收货地点：{{deliveryAddress}}。\n{{shippingTerms}}\n交付前发生的货损、灭失风险由供方承担；交付后的风险按双方约定及法律规定承担。签收只证明实际收到货物，不替代质量验收。' },
    { id: 'inspection', title: '四、验收与异议处理', body: '验收期限：{{inspectionPeriod}}。需方按合同及技术附件核对品名、规格、数量、外观、资料和性能，发现不符应及时书面通知供方。对通常验收无法发现的隐蔽质量问题，按质保约定及法律规定处理。供方接到异议后应及时核实并协商补货、维修、更换或退货。' },
    { id: 'warranty', title: '五、质保、退换货与退款', body: '质保期限及起算条件：{{warrantyPeriod}}。因供方原因产生的少货、错货或质量不合格，供方应承担合理的补货、维修、更换、退货及运输费用。双方确认退款义务后，供方应在{{refundPeriod}}内退至需方指定账户；退款账户：{{refundAccount}}。收货、付款不免除供方对产品质量及合法来源的责任。' },
    { id: 'payment', title: '六、付款、账户与发票', body: '付款方式及期限：{{paymentTerms}}。\n供方收款单位：{{payee}}；开户银行：{{bank}}；账号：{{account}}。变更收款账户须由供方书面通知，并经需方核实确认。\n发票类型：{{invoiceType}}；税率：{{taxRate}}%；开票期限：{{invoiceDeadline}}。发票内容应与实际交易一致；退货、折让涉及票据调整时，双方依法配合办理。' },
    { id: 'breach', title: '七、违约责任', body: '任何一方未按约履行，应依法承担继续履行、采取补救措施或赔偿损失等责任。因供方违约导致的合理返工、补货和延误损失，应结合原因、证据及双方责任依法处理。需方逾期付款的责任按双方特别约定及法律规定处理。约定违约金的比例、计算基数与上限应在特别约定中明确，同一损失避免重复计算。' },
    { id: 'termination', title: '八、变更、解除及不可抗力', body: '本合同的变更、补充或解除，应由双方书面确认；依法享有单方解除权的，按法律规定履行通知义务。因不可抗力影响履行的，受影响方应及时通知并在合理期限内提供证明，双方根据影响协商处理，并采取合理措施减少损失。' },
    { id: 'dispute', title: '九、通知与争议解决', body: '合同通知发送至本合同载明的联系地址或双方书面确认的电子联系方式，变更应及时通知。\n{{dispute}}' },
    { id: 'effect', title: '十、附件与合同生效', body: '经双方确认的采购明细、技术附件及书面补充协议为合同组成部分。内容不一致时按双方书面约定的优先顺序执行；没有约定的，由双方协商确认。合同经双方授权代表签署并加盖公章或合同专用章后生效。依法采用电子签署的，按法律规定及双方约定执行。' },
  ] };
}
function clean(value: unknown, name: string, limit: number) {
  if (typeof value !== 'string') throw new PurchasingError(`${name}格式不正确`);
  const s=value.trim(); if (s.length>limit) throw new PurchasingError(`${name}不能超过${limit}字`); return s;
}
export function contractContent(value: unknown): ContractContent {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new PurchasingError('合同内容格式不正确');
  const v=value as Record<string,unknown>, f=v.fields as Record<string,unknown>;
  if (!f || typeof f!=='object' || Array.isArray(f)) throw new PurchasingError('合同字段格式不正确');
  const fields={...blankFields}; for(const [key,label] of CONTRACT_FIELDS) fields[key]=clean(f[key] ?? '',label,key==='specialTerms'?6000:1500);
  if(!Array.isArray(v.clauses) || !v.clauses.length || v.clauses.length>30) throw new PurchasingError('请保留1至30项合同条款');
  const clauses=v.clauses.map((raw,i)=>{ if(!raw || typeof raw!=='object') throw new PurchasingError('条款格式不正确'); const c=raw as Record<string,unknown>;
    const result={id:clean(c.id,'条款编号',80),title:clean(c.title,'条款标题',100),body:clean(c.body,'条款正文',6000)};
    if(!result.id||!result.title||!result.body) throw new PurchasingError(`第${i+1}项条款不完整`);
    for(const match of result.body.matchAll(/\{\{([^{}]+)\}\}/g)) if(!CONTRACT_FIELDS.some(([key])=>key===match[1])) throw new PurchasingError(`条款中存在未知字段：${match[1]}`);
    return result; });
  if(new Set(clauses.map(c=>c.id)).size!==clauses.length) throw new PurchasingError('条款编号不能重复');
  if(fields.taxRate && (!/^\d{1,2}(\.\d{1,4})?$/.test(fields.taxRate)||Number(fields.taxRate)>99)) throw new PurchasingError('请填写有效税率（0至99，最多4位小数）');
  if(fields.date && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)||Number.isNaN(Date.parse(fields.date+'T00:00:00Z'))||new Date(fields.date+'T00:00:00Z').toISOString().slice(0,10)!==fields.date)) throw new PurchasingError('签订日期格式不正确');
  return {fields,clauses};
}
export function contractProblems(content: ContractContent, lines: ContractLine[]) {
  const required: ContractField[]=['title','purchaser','purchaserTaxId','purchaserAddress','purchaserContact','purchaserPhone','supplier','supplierTaxId','supplierAddress','supplierContact','supplierPhone','date','signingPlace','deliveryDate','deliveryAddress','shippingTerms',
    'qualityStandard','inspectionPeriod','warrantyPeriod','refundPeriod','paymentTerms','taxRate','invoiceType','invoiceDeadline','payee','bank','account','refundAccount','dispute'];
  const used=content.clauses.flatMap(c=>[...c.body.matchAll(/\{\{([^{}]+)\}\}/g)].map(m=>m[1] as ContractField));
  const missing=[...new Set([...required,...used])].filter(k=>!content.fields[k]).map(k=>CONTRACT_FIELDS.find(([key])=>key===k)![1]);
  if(lines.some(l=>l.estimated)) missing.push('正式成交金额（当前包含采购预估）' as typeof missing[number]);
  if(!lines.length) missing.push('采购明细' as typeof missing[number]);
  if(content.clauses.some(c=>/待填写|待确认|请填写|_{3,}|xxx公司/i.test(c.body))||Object.values(content.fields).some(s=>/待填写|待确认|请填写|_{3,}|xxx公司/i.test(s))) missing.push('未完成的占位内容' as typeof missing[number]);
  return missing;
}
export function clauseText(body: string, fields: ContractContent['fields']) {
  return body.replace(/\{\{([^{}]+)\}\}/g,(_,key:string)=>fields[key as ContractField] || `【待填写：${CONTRACT_FIELDS.find(([k])=>k===key)?.[1] || key}】`);
}
export function contractTax(amountCents: number, rate: string) {
  if(!/^\d{1,2}(\.\d{1,4})?$/.test(rate)||Number(rate)>99) return null;
  const base=1_000_000n, scale=BigInt(Math.round(Number(rate)*10000));
  const net=Number((BigInt(amountCents)*base+(base+scale)/2n)/(base+scale));
  return {netCents:net,taxCents:amountCents-net};
}
export function rmbUpper(cents: number): string {
  if(!Number.isSafeInteger(cents)||cents<0||cents>999999999999) throw new PurchasingError('人民币金额超出范围');
  if(cents===0) return '零元整';
  const digits='零壹贰叁肆伍陆柒捌玖', units=['','拾','佰','仟'];
  const group=(n:number)=>{let s='',zero=false; for(let i=3;i>=0;i--){const d=Math.floor(n/10**i)%10; if(d){if(zero&&s)s+='零';s+=digits[d]+units[i];zero=false;}else if(s)zero=true;}return s;};
  let yuan=Math.floor(cents/100), result='',gap=false;
  for(let i=2;i>=0;i--){const g=Math.floor(yuan/10000**i)%10000;if(g){if(result&&(gap||g<1000))result+='零';result+=group(g)+['','万','亿'][i];gap=false;}else if(result)gap=true;}
  result=(result||'零')+'元'; const j=Math.floor(cents%100/10), f=cents%10;
  return result+(!j&&!f?'整':(j?digits[j]+'角':f&&yuan?'零':'')+(f?digits[f]+'分':''));
}
