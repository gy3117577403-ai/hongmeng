import { notFound } from 'next/navigation';
import { requirePageAccess } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { fgWaybills } from '@/lib/finished-goods-domain';
import PrintButton from '@/components/finished-goods/PrintButton';
import './print.css';
export const dynamic = 'force-dynamic';
export default async function FinishedGoodsPrint({ params }: { params: { id: string } }) {
  await requirePageAccess('/workspace/finished-goods');
  const shipment = await prisma.fgShipment.findUnique({ where: { id: params.id }, include: { lines: { include: { lot: true } }, batch: true } });
  if (!shipment) notFound();
  return <main className="fg-print"><PrintButton/><h1>杭连电子 · 成品发货单</h1><p className="fg-print-no">{shipment.number} {shipment.status !== 'SHIPPED' && '（未发货草稿）'}</p><div className="fg-print-info"><p>客户：<b>{shipment.customerName}</b></p><p>实际发货：{shipment.shippedAt?.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) || '未发货'}</p><p>收货人：{shipment.recipient || shipment.handoverName || '—'}　{shipment.phone}</p><p>批次：{shipment.batch?.number || '未分批'}</p><p className="full">收货地址：{shipment.address || (shipment.method === 'PICKUP' ? '客户自提' : '—')}</p></div><table><thead><tr><th>序号</th><th>工单号</th><th>产品名称</th><th>规格 / 图号</th><th>数量</th><th>单位</th></tr></thead><tbody>{shipment.lines.map((line,index) => <tr key={line.id}><td>{index+1}</td><td>{line.lot.workOrderCode}</td><td>{line.lot.productName}</td><td>{line.lot.specification}</td><td>{line.quantity}</td><td>{line.lot.unit}</td></tr>)}</tbody><tfoot><tr><td colSpan={4}>合计</td><td>{shipment.lines.reduce((sum,line) => sum+line.quantity,0)}</td><td>—</td></tr></tfoot></table><div className="fg-print-info"><p>箱数：{shipment.boxes}</p><p>承运商 / 方式：{shipment.method === 'PICKUP' ? '自提' : shipment.carrier || '专车送货'}</p><p className="full">运单：{fgWaybills(shipment.waybills).join('，') || '待补录'}</p><p className="full">备注：{shipment.note || '—'}</p><p>发货经办：{shipment.actorName}</p><p>收货签字：________________</p></div></main>;
}
