'use client';
import { Save, AlertTriangle } from 'lucide-react';
export function QualityDraftNotice({ draft, busy = false }: { draft: { dirty: boolean; conflict: boolean; storageAvailable: boolean; useServer: () => void; keepDraft: () => void }; busy?: boolean }) {
  return <div className={`qv4-draft ${draft.conflict ? 'conflict' : ''}`} role="status">
    {draft.conflict ? <><AlertTriangle size={16} /><span>这部分内容已被其他人员更新。你的输入仍保留，请比较当前记录后选择。</span><button type="button" disabled={busy} onClick={draft.useServer}>使用服务器内容</button><button type="button" disabled={busy} onClick={draft.keepDraft}>保留我的输入继续编辑</button></>
      : <><Save size={15} /><span>{busy ? '正在保存，请稍候…' : draft.dirty ? draft.storageAvailable ? '尚未提交 · 已在当前标签页保留草稿' : '尚未保存 · 请保持页面打开' : '与服务器记录一致'}</span></>}
  </div>;
}
