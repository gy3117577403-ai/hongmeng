import { NextRequest, NextResponse } from 'next/server';

import { listToolingWork } from '@/lib/tooling-worklog-service';
import { toolingFailure, requireTooling } from '@/lib/tooling-worklog-api';
import { TOOLING_MODES, TOOLING_SOURCES, type ToolingMode, durationText, TOOLING_STATES, TOOLING_POSITION_NAMES } from '@/lib/tooling-worklog-domain';
export const dynamic = 'force-dynamic';
const cell = (v: unknown) => '"' + String(v ?? '').replace(/^[=+@-]/, x => "'" + x).replace(/"/g, '""') + '"';
export async function GET(req: NextRequest) { try {
  const data = await listToolingWork(await requireTooling('READ'), req.nextUrl.searchParams);
  const rows: unknown[][] = [['工号','姓名','工作类型','调模方式','记录来源','专模型号','专模归属位置','补录原因','端子型号','工作内容','状态','开始时间','结束时间','所选周期有效工时','所选周期暂停时间','结果','刀位组合']];
  for (const j of data.jobs) rows.push([j.employeeNo,j.actorName,j.kind === 'TUNING' ? '调模' : j.category,j.kind === 'TUNING' ? TOOLING_MODES[j.toolingMode as ToolingMode] : '协助',TOOLING_SOURCES[j.recordSource],(j.moldUsage?.snapshot as {model?:string}|undefined)?.model,(j.moldUsage?.snapshot as {homePosition?:number}|undefined)?.homePosition,j.backfillReason,(j.terminalSnapshot as { specification?: string }).specification,j.description,TOOLING_STATES[j.status],j.startedAt.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),j.endedAt?.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),durationText(j.period.workMs),durationText(j.period.waitMs),j.resultNote,j.usages.filter(u=>u.isCurrent).map(u=>TOOLING_POSITION_NAMES[u.position]+':'+(u.snapshot as {model:string}).model).join(' / ')]);
  return new NextResponse('\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="terminal-tooling-worklog.csv"','Cache-Control':'no-store'}});
} catch(e) { return toolingFailure(e); } }
