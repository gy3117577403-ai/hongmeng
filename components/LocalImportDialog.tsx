'use client';

import { useState } from 'react';

export type LocalImportConnectionState = 'creating' | 'launching' | 'connected' | 'unavailable' | 'error';

export type LocalImportTaskView = {
  taskId: string;
  expiresAt: string;
  pairingCode?: string;
  pairingAvailable?: boolean;
  workOrder: {
    id: string;
    displayCode: string;
    customerName: string;
    productName: string;
  };
  category: {
    id: string;
    name: string;
    code: string;
  };
  summary: {
    state: string;
    successCount: number;
    duplicateCount: number;
    failedCount: number;
    processedCount: number;
  };
};

const connectionText: Record<LocalImportConnectionState, string> = {
  creating: '正在创建短期任务',
  launching: '正在唤起助手',
  connected: '助手已连接',
  unavailable: '助手未连接',
  error: '连接失败',
};

const taskText: Record<string, string> = {
  waiting: '等待文件',
  connected: '等待文件',
  uploading: '正在上传',
  paused: '队列已暂停',
  completed: '上传完成',
  expired: '任务已过期',
};

export function LocalImportDialog({
  open,
  task,
  connection,
  error,
  retry,
  recreate,
  retryDisabled,
  close,
}: {
  open: boolean;
  task: LocalImportTaskView | null;
  connection: LocalImportConnectionState;
  error: string;
  retry: () => void;
  recreate: () => void;
  retryDisabled: boolean;
  close: () => void;
}) {
  const [copyMessage, setCopyMessage] = useState('');
  if (!open) return null;
  const expiresLabel = task ? new Date(task.expiresAt).toLocaleString('zh-CN', { hour12: false }) : '-';
  const summary = task?.summary;
  const expired = summary?.state === 'expired' || (task ? new Date(task.expiresAt).getTime() <= Date.now() : false);
  const pairingAvailable = Boolean(task?.pairingCode) && task?.pairingAvailable !== false && !expired;
  const canCreateNewCode = Boolean(task) && (expired || task?.pairingAvailable === false || connection === 'unavailable' || connection === 'error');

  async function copyPairingCode() {
    const value = task?.pairingCode || '';
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const area = document.createElement('textarea');
        area.value = value;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        if (!document.execCommand('copy')) throw new Error('copy_failed');
        area.remove();
      }
      setCopyMessage('已复制');
    } catch {
      setCopyMessage('复制失败，请手动输入');
    }
  }

  return (
    <div className="modal-backdrop local-import-backdrop" role="presentation">
      <section className="modal-card local-import-dialog" role="dialog" aria-modal="true" aria-labelledby="local-import-title">
        <div className="local-import-head">
          <div>
            <span>Windows 微盘导入助手</span>
            <h2 id="local-import-title">从微盘导入</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={close}>×</button>
        </div>

        {task ? (
          <div className="local-import-task-grid">
            <span><b>客户</b><em>{task.workOrder.customerName || '未设置'}</em></span>
            <span><b>规格</b><em title={task.workOrder.displayCode}>{task.workOrder.displayCode}</em></span>
            <span><b>目标分类</b><em>{task.category.name}</em></span>
            <span><b>有效期至</b><em>{expiresLabel}</em></span>
          </div>
        ) : (
          <div className="local-import-preparing">正在为当前工单和分类创建一次性导入任务...</div>
        )}

        <div className="local-import-state-row">
          <span className={`connection-dot ${connection}`} />
          <div>
            <b>{connectionText[connection]}</b>
            <small>{taskText[summary?.state || 'waiting'] || summary?.state || '等待任务'}</small>
          </div>
        </div>

        {summary && (
          <div className="local-import-counts">
            <span><b>{summary.successCount}</b><small>成功</small></span>
            <span><b>{summary.duplicateCount}</b><small>重复跳过</small></span>
            <span><b>{summary.failedCount}</b><small>失败</small></span>
          </div>
        )}

        <div className="local-import-instructions">
          <strong>助手打开后可任选一种方式</strong>
          <p>从企业微信微盘拖入真实文件、复制文件后按 Ctrl+V，或点击下载并由助手监控下载目录。</p>
          <p>助手不会读取企业微信 Cookie，也不会保存系统密码或对象存储密钥。</p>
        </div>

        {pairingAvailable && (
          <div className="local-import-pairing">
            <div>
              <strong>浏览器协议未打开时，使用手动连接码</strong>
              <p>普通双击打开助手，在“手动任务码”中输入；任务码限时且只允许一个助手连接，同一助手可安全重试。</p>
            </div>
            <code>{task?.pairingCode}</code>
            <button type="button" onClick={() => void copyPairingCode()}>复制任务码</button>
            {copyMessage && <small>{copyMessage}</small>}
          </div>
        )}

        <p className="local-import-browser-tip">浏览器弹出“打开工单资料库微盘导入助手”时，请点击允许。不需要管理员权限。</p>

        {error && <div className="form-error">{error}</div>}

        <div className="local-import-actions">
          <button type="button" onClick={close}>关闭</button>
          {connection === 'launching' && !expired && (
            <button type="button" disabled>正在唤起...</button>
          )}
          {(connection === 'unavailable' || connection === 'error') && !expired && (
            <button type="button" disabled={retryDisabled} onClick={retry}>{retryDisabled ? '请稍候...' : '重新唤起助手'}</button>
          )}
          {canCreateNewCode && <button type="button" onClick={recreate}>一键生成新任务码</button>}
          {(connection === 'unavailable' || connection === 'error') && (
            <a className="primary-button" href="https://github.com/gy3117577403-ai/hongmeng/actions/workflows/windows-import-helper.yml" target="_blank" rel="noreferrer">下载导入助手</a>
          )}
        </div>
      </section>
    </div>
  );
}
