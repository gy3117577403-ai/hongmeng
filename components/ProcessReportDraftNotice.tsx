'use client';

import type { ProcessReportDraft } from '@/lib/process-report-draft';

export function ProcessReportDraftNotice({ draft, restore, discard }: { draft: ProcessReportDraft; restore: () => void; discard: () => void }) {
  return <section className="process-report-recovery-notice" role="status">
    <div><strong>{draft.request ? '这笔报工已提交过，正在核对结果' : '发现本账号的本机草稿'}</strong>
      <p>{draft.request ? '请使用原编号续传，不要重新建立一笔。数量、人员与来源仍保存在本机。' : '恢复后请核对实际生产日期、数量、人员和来源。草稿尚未提交，也未计入工时。'}</p></div>
    <button type="button" onClick={restore}>{draft.request ? '查看保留内容' : '恢复并核对'}</button>
    {!draft.request && <button type="button" onClick={discard}>放弃旧草稿</button>}
  </section>;
}
