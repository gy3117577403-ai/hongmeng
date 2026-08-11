'use client';

import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  Clock3,
  GitPullRequestArrow,
  ListPlus,
  LoaderCircle,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  canSubmitProcessRouteChangeProposal,
  millisecondsFromSeconds,
  normalizeOptionalProcessRouteChangeNote,
  processRouteChangeIdempotencyKey,
  processRouteChangeStatusLabels,
  processRouteChangeTypeLabel,
  secondsFromMilliseconds,
  type ProcessRouteChangeDTO,
  type ProcessRouteChangeListResponse,
  type ProcessRouteChangeType,
} from '@/lib/process-route-change-contract';

type ProposalStep = {
  id: string;
  position: number;
  sequenceGroup: number;
  processName: string;
  status: string;
  standardMillisecondsPerUnit?: number | null;
};

type TimeChangeRow = {
  key: string;
  stepId: string;
  seconds: string;
};

function jsonError(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value) {
    const message = String((value as { error?: unknown }).error || '').trim();
    if (message) return message;
  }
  return fallback;
}

function timeRow(step?: ProposalStep): TimeChangeRow {
  return {
    key: processRouteChangeIdempotencyKey('time'),
    stepId: step?.id || '',
    seconds: secondsFromMilliseconds(step?.standardMillisecondsPerUnit),
  };
}

export function FieldReportRouteChangeProposal({
  code,
  routeVersion,
  steps,
  targetQty,
  unitLabel,
  employeeAvailable,
  onSubmitted,
}: {
  code: string;
  routeVersion: number;
  steps: ProposalStep[];
  targetQty: number;
  unitLabel: string;
  employeeAvailable: boolean;
  onSubmitted?: () => void;
}) {
  const firstPending = steps.find(step => step.status !== 'completed') || steps.at(-1);
  const [open, setOpen] = useState(false);
  const [changeType, setChangeType] = useState<ProcessRouteChangeType>('INSERT_STEP');
  const [insertBeforeStepId, setInsertBeforeStepId] = useState(firstPending?.id || '');
  const [moveStepId, setMoveStepId] = useState(firstPending?.id || steps[0]?.id || '');
  const [moveBeforeStepId, setMoveBeforeStepId] = useState('');
  const [newProcessName, setNewProcessName] = useState('');
  const [newStandardSeconds, setNewStandardSeconds] = useState('');
  const [affectedQty, setAffectedQty] = useState(String(Math.max(0, targetQty)));
  const [reason, setReason] = useState('');
  const [timeChanges, setTimeChanges] = useState<TimeChangeRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [proposals, setProposals] = useState<ProcessRouteChangeDTO[]>([]);

  const loadProposals = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await fetch(`/api/field-report/tickets/${encodeURIComponent(code)}/process-route-changes`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as Partial<ProcessRouteChangeListResponse> & { changes?: ProcessRouteChangeDTO[] };
      if (!response.ok) return;
      setProposals(Array.isArray(body.data) ? body.data : Array.isArray(body.changes) ? body.changes : []);
    } finally {
      setLoadingList(false);
    }
  }, [code]);

  useEffect(() => { void loadProposals(); }, [loadProposals]);

  const includesInsert = changeType === 'INSERT_STEP' || changeType === 'BOTH';
  const includesTime = changeType === 'UPDATE_TIME' || changeType === 'BOTH';
  const includesMove = changeType === 'MOVE_STEP';
  const routeGroups = useMemo(() => {
    const groups = new Map<number, ProposalStep[]>();
    for (const step of [...steps].sort((left, right) => left.sequenceGroup - right.sequenceGroup || left.position - right.position)) {
      const group = groups.get(step.sequenceGroup) || [];
      group.push(step);
      groups.set(step.sequenceGroup, group);
    }
    return [...groups.entries()].map(([sequenceGroup, groupSteps]) => ({ sequenceGroup, steps: groupSteps }));
  }, [steps]);
  const moveSourceGroup = routeGroups.find(group => group.steps.some(step => step.id === moveStepId)) || null;
  const moveBeforeGroup = moveBeforeStepId
    ? routeGroups.find(group => group.steps.some(step => step.id === moveBeforeStepId)) || null
    : null;
  const moveSourceIndex = moveSourceGroup ? routeGroups.indexOf(moveSourceGroup) : -1;
  const moveBeforeIndex = moveBeforeGroup ? routeGroups.indexOf(moveBeforeGroup) : routeGroups.length;
  const moveIsNoop = includesMove && (
    moveSourceIndex < 0
    || moveBeforeGroup?.sequenceGroup === moveSourceGroup?.sequenceGroup
    || moveBeforeIndex === moveSourceIndex + 1
    || (!moveBeforeGroup && moveSourceIndex === routeGroups.length - 1)
  );
  const parsedAffectedQty = Number(affectedQty);
  const parsedNewStandard = millisecondsFromSeconds(newStandardSeconds);
  const normalizedTimeChanges = useMemo(() => timeChanges.map(row => ({
    stepId: row.stepId,
    standardMillisecondsPerUnit: millisecondsFromSeconds(row.seconds),
  })), [timeChanges]);
  const invalid = !canSubmitProcessRouteChangeProposal({
    saving,
    employeeAvailable,
    affectedQty: parsedAffectedQty,
    includesInsert,
    insertBeforeStepId,
    newProcessName,
    newStandardMillisecondsPerUnit: parsedNewStandard,
    includesTime,
    timeChangesValid: Boolean(normalizedTimeChanges.length)
      && normalizedTimeChanges.every(item => Boolean(item.stepId && item.standardMillisecondsPerUnit)),
    includesMove,
    moveStepId,
    moveIsNoop,
  });
  const latest = proposals[0] || null;

  function reset(): void {
    setChangeType('INSERT_STEP');
    setInsertBeforeStepId(firstPending?.id || '');
    setMoveStepId(firstPending?.id || steps[0]?.id || '');
    setMoveBeforeStepId('');
    setNewProcessName('');
    setNewStandardSeconds('');
    setAffectedQty(String(Math.max(0, targetQty)));
    setReason('');
    setTimeChanges([]);
    setError('');
  }

  function chooseType(next: ProcessRouteChangeType): void {
    setChangeType(next);
    setError('');
    if ((next === 'UPDATE_TIME' || next === 'BOTH') && !timeChanges.length) {
      setTimeChanges([timeRow(firstPending || steps[0])]);
    }
  }

  async function submit(): Promise<void> {
    if (invalid) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/field-report/tickets/${encodeURIComponent(code)}/process-route-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changeType,
          expectedRouteVersion: routeVersion,
          insertBeforeStepId: includesInsert ? insertBeforeStepId : null,
          moveStepId: includesMove ? moveStepId : null,
          moveBeforeStepId: includesMove ? moveBeforeStepId || null : null,
          movePosition: includesMove
            ? moveBeforeGroup?.steps[0]?.position ?? steps.length
            : null,
          newProcessName: includesInsert ? newProcessName.trim() : null,
          newStandardMillisecondsPerUnit: includesInsert ? parsedNewStandard : null,
          affectedQty: parsedAffectedQty,
          timeChanges: includesTime ? normalizedTimeChanges : [],
          reason: normalizeOptionalProcessRouteChangeNote(reason),
          idempotencyKey: processRouteChangeIdempotencyKey('field-change'),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(jsonError(body, '工艺变更提案提交失败'));
      setOpen(false);
      reset();
      setMessage('已提交给工艺审核，启用前不会改动当前工序和历史报工。');
      await loadProposals();
      onSubmitted?.();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : '工艺变更提案提交失败');
    } finally {
      setSaving(false);
    }
  }

  return <>
    <section className="field-report-change-entry">
      <span><GitPullRequestArrow size={21} /><i><strong>发现漏工序、顺序或工时不对？</strong><small>在当前二维码中提交，工艺审核启用后自动更新。</small></i></span>
      <button type="button" disabled={!employeeAvailable || !steps.length} onClick={() => { setOpen(true); setMessage(''); }}><ListPlus size={17} />提交工艺变更</button>
      {latest && <p><Clock3 size={14} /><span>最近提案：{processRouteChangeTypeLabel(latest.payload.changeType)} · <b>{processRouteChangeStatusLabels[latest.status]}</b></span>{loadingList && <LoaderCircle className="spin" size={13} />}</p>}
      {message && <em><CheckCircle2 size={15} />{message}</em>}
    </section>

    {open && <div className="field-report-change-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setOpen(false); }}>
      <section className="field-report-change-dialog" role="dialog" aria-modal="true" aria-labelledby="field-report-change-title">
        <header><span><small>现场工艺变更</small><strong id="field-report-change-title">提交给工艺审核</strong></span><button type="button" disabled={saving} aria-label="关闭" onClick={() => setOpen(false)}><X size={21} /></button></header>
        <div className="field-report-change-scroll">
          <section className="field-report-change-types" aria-label="变更类型">
            {(['INSERT_STEP', 'UPDATE_TIME', 'MOVE_STEP', 'BOTH'] as const).map(value => <button className={changeType === value ? 'active' : ''} type="button" disabled={saving} key={value} onClick={() => chooseType(value)}>{value === 'INSERT_STEP' ? <ListPlus size={18} /> : value === 'UPDATE_TIME' ? <Clock3 size={18} /> : value === 'MOVE_STEP' ? <ArrowDownUp size={18} /> : <GitPullRequestArrow size={18} />}<span><strong>{processRouteChangeTypeLabel(value)}</strong><small>{value === 'INSERT_STEP' ? '在指定位置插入' : value === 'UPDATE_TIME' ? '修改已有工序标准' : value === 'MOVE_STEP' ? '整组安全移动' : '一次一起审核'}</small></span></button>)}
          </section>

          {includesInsert && <fieldset className="field-report-change-group"><legend>新增工序</legend>
            <label><span>插入位置</span><select value={insertBeforeStepId} disabled={saving} onChange={event => setInsertBeforeStepId(event.target.value)}>{steps.map(step => <option value={step.id} key={step.id}>在第 {step.position} 道「{step.processName}」之前</option>)}</select></label>
            <label><span>新工序名称</span><input value={newProcessName} maxLength={80} disabled={saving} placeholder="例：热缩管定位" onChange={event => setNewProcessName(event.target.value)} /></label>
            <label><span>标准工时</span><div><input inputMode="decimal" value={newStandardSeconds} disabled={saving} placeholder="0" onChange={event => setNewStandardSeconds(event.target.value)} /><em>秒/{unitLabel}</em></div></label>
          </fieldset>}

          {includesTime && <fieldset className="field-report-change-group"><legend>工时变更</legend>
            <p>审核启用后，已报工记录也将按新标准追溯重算达成率。</p>
            {timeChanges.map((row, index) => <div className="field-report-time-change" key={row.key}>
              <select aria-label={`第 ${index + 1} 项工时变更工序`} value={row.stepId} disabled={saving} onChange={event => setTimeChanges(items => items.map(item => item.key === row.key ? { ...item, stepId: event.target.value, seconds: secondsFromMilliseconds(steps.find(step => step.id === event.target.value)?.standardMillisecondsPerUnit) } : item))}>{steps.map(step => <option value={step.id} key={step.id}>{step.position}. {step.processName}</option>)}</select>
              <label><input inputMode="decimal" value={row.seconds} disabled={saving} aria-label="新标准工时（秒）" onChange={event => setTimeChanges(items => items.map(item => item.key === row.key ? { ...item, seconds: event.target.value } : item))} /><em>秒/{unitLabel}</em></label>
              <button type="button" disabled={saving || timeChanges.length === 1} aria-label="删除这项工时变更" onClick={() => setTimeChanges(items => items.filter(item => item.key !== row.key))}><Trash2 size={16} /></button>
            </div>)}
            <button className="field-report-add-time" type="button" disabled={saving || timeChanges.length >= steps.length} onClick={() => setTimeChanges(items => [...items, timeRow(steps.find(step => !items.some(item => item.stepId === step.id)) || steps[0])])}><Plus size={16} />再调整一道工序工时</button>
          </fieldset>}

          {includesMove && <fieldset className="field-report-change-group"><legend>工序顺序调整</legend>
            <p>为保证数量账本一致，同一顺序组会整组移动；已报工、已入站或已产出的范围不允许改写。</p>
            <label><span>要移动的顺序组</span><select value={moveStepId} disabled={saving} onChange={event => { setMoveStepId(event.target.value); setMoveBeforeStepId(''); }}>{routeGroups.map(group => <option value={group.steps[0].id} key={group.sequenceGroup}>顺序组 {group.sequenceGroup}：{group.steps.map(step => step.processName).join('、')}</option>)}</select></label>
            <label><span>移动到</span><select value={moveBeforeStepId} disabled={saving} onChange={event => setMoveBeforeStepId(event.target.value)}><option value="">路线末尾</option>{routeGroups.filter(group => group.sequenceGroup !== moveSourceGroup?.sequenceGroup).map(group => <option value={group.steps[0].id} key={group.sequenceGroup}>顺序组 {group.sequenceGroup}之前：{group.steps.map(step => step.processName).join('、')}</option>)}</select></label>
            {moveIsNoop && <p>该选择与当前顺序相同，请选择其他落点。</p>}
          </fieldset>}

          <fieldset className="field-report-change-group"><legend>生效数量与现场说明</legend>
            <label><span>当前工单应报数量（整单）</span><div><input inputMode="numeric" value={affectedQty} disabled readOnly /><em>{unitLabel}</em></div></label>
            <label><span>现场说明（可选）</span><textarea value={reason} rows={3} maxLength={500} disabled={saving} placeholder="可不填；如需补充，可说明发现位置或实际执行情况" onChange={event => setReason(event.target.value)} /></label>
          </fieldset>

          <section className="field-report-change-note"><AlertTriangle size={18} /><span><strong>提交不会立即改工艺</strong><small>仅工艺审核并点击启用后生效；顺序调整启用时会再次校验报工与数量账本。</small></span></section>
          {error && <div className="field-report-form-error" role="alert">{error}</div>}
        </div>
        <footer><span>当前路线 R{routeVersion} · 审批时将重新核对版本</span><button type="button" disabled={invalid} onClick={() => void submit()}>{saving ? <><LoaderCircle className="spin" size={18} />正在提交...</> : <><Send size={18} />提交工艺审核</>}</button></footer>
      </section>
    </div>}
  </>;
}
