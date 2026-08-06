'use client';

import {
  Check,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  UsersRound,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Recipient = {
  id: string;
  employeeNo: string;
  name: string;
  department: string | null;
  position: string | null;
  team: string | null;
  maskedMobile: string;
};

type WeComStatus = {
  ok: boolean;
  config: {
    configured: boolean;
    state: 'ready' | 'missing' | 'invalid';
    endpointHost: string | null;
  };
  recipients: Recipient[];
  counts: {
    activeWithMobile: number;
    eligible: number;
    paused: number;
    unsupported: number;
  };
  limits: {
    maxRecipients: number;
    cooldownSeconds: number;
  };
  lastSuccessAt: string | null;
};

function formatTime(value: string | null) {
  if (!value) return '尚未试发';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未试发';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function WeComRobotSettingsCard({ canSend }: { canSend: boolean }) {
  const [status, setStatus] = useState<WeComStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/integrations/wecom/robot', { cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as Partial<WeComStatus> & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || '企业微信配置状态加载失败');
      const next = body as WeComStatus;
      setStatus(next);
      const allowed = new Set(next.recipients.map(item => item.id));
      setSelectedIds(current => current.filter(id => allowed.has(id)));
      setFeedback(null);
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : '企业微信配置状态加载失败' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const filteredRecipients = useMemo(() => {
    const normalized = keyword.normalize('NFKC').trim().toLowerCase();
    if (!normalized) return status?.recipients || [];
    return (status?.recipients || []).filter(item => (
      `${item.employeeNo} ${item.name} ${item.department || ''} ${item.position || ''} ${item.team || ''}`
        .toLowerCase()
        .includes(normalized)
    ));
  }, [keyword, status?.recipients]);

  const selectedRecipients = useMemo(() => {
    const selected = new Set(selectedIds);
    return (status?.recipients || []).filter(item => selected.has(item.id));
  }, [selectedIds, status?.recipients]);

  const maxRecipients = status?.limits.maxRecipients || 20;
  const allVisibleSelected = filteredRecipients.length > 0 && filteredRecipients.every(item => selectedIds.includes(item.id));

  function changeSelection(next: string[]) {
    setSelectedIds(next.slice(0, maxRecipients));
    setConfirmed(false);
    setFeedback(null);
  }

  function toggleRecipient(id: string) {
    if (selectedIds.includes(id)) {
      changeSelection(selectedIds.filter(item => item !== id));
      return;
    }
    if (selectedIds.length >= maxRecipients) {
      setFeedback({ tone: 'error', text: `一次最多选择 ${maxRecipients} 人进行联调` });
      return;
    }
    changeSelection([...selectedIds, id]);
  }

  function toggleVisible() {
    const visibleIds = filteredRecipients.map(item => item.id);
    if (allVisibleSelected) {
      changeSelection(selectedIds.filter(id => !visibleIds.includes(id)));
      return;
    }
    changeSelection([...new Set([...selectedIds, ...visibleIds])]);
  }

  async function sendTest() {
    if (!status?.config.configured || !selectedIds.length || !confirmed || sending) return;
    setSending(true);
    setFeedback(null);
    try {
      const response = await fetch('/api/integrations/wecom/robot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: selectedIds, confirmed: true }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error || '企业微信试发失败');
      setFeedback({ tone: 'success', text: body.message || '企业微信已接收测试消息，请到群内确认' });
      setConfirmed(false);
      setStatus(current => current ? { ...current, lastSuccessAt: new Date().toISOString() } : current);
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : '企业微信试发失败' });
    } finally {
      setSending(false);
    }
  }

  const configReady = Boolean(status?.config.configured);
  const canSubmit = canSend && configReady && selectedIds.length > 0 && confirmed && !sending;

  return (
    <section className="settings-wecom" aria-labelledby="settings-wecom-title">
      <header className="settings-wecom-hero">
        <span className="settings-wecom-logo" aria-hidden="true"><MessageSquareText size={25} /></span>
        <div>
          <small>消息集成 · 联调版</small>
          <h3 id="settings-wecom-title">企业微信群消息推送</h3>
          <p>向机器人所在群发送一条固定测试消息，并按人事档案手机号提醒所选员工。</p>
        </div>
        <span className={`settings-wecom-state ${configReady ? 'ready' : 'pending'}`}>
          {loading ? <LoaderCircle className="spin" size={15} /> : configReady ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
          {loading ? '检查中' : configReady ? 'Webhook 已配置' : status?.config.state === 'invalid' ? '配置无效' : '等待配置'}
        </span>
        <button className="settings-wecom-refresh" type="button" onClick={() => void loadStatus()} disabled={loading} aria-label="刷新企业微信配置状态">
          <RefreshCw className={loading ? 'spin' : ''} size={18} />
        </button>
      </header>

      {!loading && !configReady && (
        <div className="settings-wecom-setup" role="status">
          <CircleAlert size={21} aria-hidden="true" />
          <div>
            <strong>{status?.config.state === 'invalid' ? 'Webhook 格式不正确' : '还差一步即可开始试发'}</strong>
            <ol>
              <li>在目标企业微信群中创建“消息推送（原群机器人）”，复制完整 Webhook。</li>
              <li>在 Sealos 应用环境变量中新增 <code>WECOM_ROBOT_WEBHOOK_URL</code>，值为完整 Webhook。</li>
              <li>保存并重启应用，然后点击右上角刷新状态。</li>
            </ol>
            <p>Webhook 是群的发送密钥，不要发到聊天、截图、代码仓库或普通配置表中。</p>
          </div>
        </div>
      )}

      <div className="settings-wecom-stats" aria-label="企业微信可通知员工统计">
        <div><span><UsersRound size={17} /></span><small>可试发员工</small><strong>{status?.counts.eligible ?? '—'}</strong><em>人</em></div>
        <div><small>已录手机号</small><strong>{status?.counts.activeWithMobile ?? '—'}</strong><em>人</em></div>
        <div><small>通知已暂停</small><strong>{status?.counts.paused ?? '—'}</strong><em>人</em></div>
        <div><small>上次成功</small><strong className="time">{formatTime(status?.lastSuccessAt || null)}</strong></div>
      </div>

      <div className="settings-wecom-toolbar">
        <label>
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">搜索试发员工</span>
          <input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="按员工编号、姓名、部门或岗位搜索" />
        </label>
        <button type="button" onClick={toggleVisible} disabled={!filteredRecipients.length}>
          {allVisibleSelected ? '取消当前结果' : '选择当前结果'}
        </button>
        <span>已选 <b>{selectedIds.length}</b> / {maxRecipients} 人</span>
      </div>

      <div className="settings-wecom-people" aria-busy={loading}>
        {loading && <div className="settings-wecom-empty"><LoaderCircle className="spin" size={24} /><strong>正在读取人事档案…</strong></div>}
        {!loading && filteredRecipients.map(item => {
          const selected = selectedIds.includes(item.id);
          return (
            <button
              key={item.id}
              className={selected ? 'selected' : ''}
              type="button"
              onClick={() => toggleRecipient(item.id)}
              aria-pressed={selected}
            >
              <span className="settings-wecom-check" aria-hidden="true">{selected && <Check size={15} />}</span>
              <span className="settings-wecom-person">
                <strong>{item.employeeNo} · {item.name}</strong>
                <small>{[item.department, item.position, item.team].filter(Boolean).join(' · ') || '员工档案'}</small>
              </span>
              <em>{item.maskedMobile}</em>
            </button>
          );
        })}
        {!loading && !filteredRecipients.length && (
          <div className="settings-wecom-empty">
            <UsersRound size={24} />
            <strong>{status?.recipients.length ? '没有匹配的员工' : '暂无可试发员工'}</strong>
            <span>{status?.recipients.length ? '换一个编号或姓名试试' : '请先为在职员工填写手机号并保持通知开启'}</span>
          </div>
        )}
      </div>

      <section className="settings-wecom-preview" aria-label="试发确认">
        <div>
          <small>本次消息预览</small>
          <strong>【杭连电子协同平台｜连接测试】</strong>
          <p>{selectedRecipients.length
            ? `将发送 1 条消息并尝试提醒：${selectedRecipients.map(item => `${item.employeeNo} ${item.name}`).join('、')}`
            : '选择员工后，这里会显示本次提醒对象。'}</p>
          <span>企业微信接口返回成功只代表消息进入群；员工手机号需与企微通讯录一致且员工在该群内，才能被正确 @。</span>
        </div>
        <label className="settings-wecom-confirm">
          <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!canSend || !configReady || !selectedIds.length || sending} />
          <span>我确认发送真实测试消息</span>
        </label>
        <button className="settings-wecom-send" type="button" onClick={() => void sendTest()} disabled={!canSubmit}>
          {sending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
          {sending ? '正在发送…' : `发送测试${selectedIds.length ? `（${selectedIds.length}人）` : ''}`}
        </button>
      </section>

      {!canSend && <div className="settings-wecom-feedback error" role="status"><CircleAlert size={17} />当前账号只能查看连接状态，请使用系统管理员账号试发。</div>}
      {feedback && <div className={`settings-wecom-feedback ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
        {feedback.tone === 'success' ? <CheckCircle2 size={17} /> : <CircleAlert size={17} />}{feedback.text}
      </div>}
    </section>
  );
}
