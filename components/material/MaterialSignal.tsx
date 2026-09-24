import { Check, ChevronRight, CircleUserRound } from 'lucide-react';
import type { MaterialFollowUpStatusDTO, WarehouseMaterialExceptionCaseDTO } from '@/types';

export const materialPhases = [
  ['PENDING', '待接收'], ['IN_PROGRESS', '跟进中'], ['WAITING_ARRIVAL', '等待到料'],
  ['WAITING_WAREHOUSE', '仓库核实'], ['RESOLVED', '已解决'],
] as const;

export function nextMaterialAction(event: WarehouseMaterialExceptionCaseDTO) {
  if (event.status === 'RESOLVED') return { who: '仓库已确认', action: '本项已闭环', tone: 'green' };
  if (event.followUpStatus === 'WAITING_WAREHOUSE') return { who: '下一步 · 仓库', action: '核对到料实物', tone: 'blue' };
  if (!event.owner) return { who: '尚未分配', action: '分配负责人 / 自己接收', tone: 'red' };
  if (event.followUpStatus === 'PENDING') return { who: '等待本人接收', action: `等待 ${event.owner.displayName || event.owner.username} 接收`, tone: 'orange' };
  if (event.followUpStatus === 'WAITING_ARRIVAL') return { who: '下一步 · 跟进人', action: '跟踪到料并反馈', tone: 'orange' };
  return { who: '下一步 · 跟进人', action: '更新进展与交期', tone: 'orange' };
}

export function MaterialOwner({ event }: { event: WarehouseMaterialExceptionCaseDTO }) {
  return <span className={`mg-owner ${event.owner ? '' : 'mg-unassigned'}`}><CircleUserRound size={13}/>{event.owner?.displayName || event.owner?.username || '待分配'}</span>;
}

export function MaterialProgress({ status }: { status?: MaterialFollowUpStatusDTO | null }) {
  const active = materialPhases.findIndex(([key]) => key === (status || 'PENDING'));
  return <div className="mg-process" aria-label={`当前阶段：${materialPhases[active]?.[1] || '已取消'}`}>
    {materialPhases.map(([key, text], index) => <div key={key} className={index < active ? 'passed' : index === active ? 'current' : ''}>
      <i>{index < active ? <Check size={12}/> : index + 1}</i><span>{text}</span>{index < 4 && <ChevronRight size={13}/>}
    </div>)}
  </div>;
}
