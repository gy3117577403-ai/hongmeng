'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  GraduationCap,
  Loader2,
  LogOut,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Send,
  Star,
  UserRoundCheck,
} from 'lucide-react';

type ScanPayload = {
  purpose: 'CHECK_IN' | 'FEEDBACK';
  window: { id: string; status: 'SCHEDULED' | 'OPEN' | 'EXPIRED' | 'CLOSED' | 'REVOKED'; opensAt: string; expiresAt: string };
  plan: { id: string; code: string; title: string; mode: string };
  session: { id: string; name: string; startAt: string; endAt: string; location: string | null; status: string };
  participant: { id: string; employeeNo: string; employeeName: string; department: string | null; team: string | null };
  attendance: { id: string; status: string; checkInAt: string | null; source: string; version: number } | null;
  feedback: {
    id: string;
    overallRating: number;
    contentRating: number;
    trainerRating: number;
    practicalValueRating: number;
    issueTags: string[];
    comment: string | null;
    followUpRequested: boolean;
    submittedAt: string;
    updatedAt: string;
    version: number;
  } | null;
  serverTime: string;
  idempotent?: boolean;
  saved?: boolean;
};

type FeedbackDraft = {
  overallRating: number;
  contentRating: number;
  trainerRating: number;
  practicalValueRating: number;
  issueTags: string[];
  comment: string;
  followUpRequested: boolean;
  version: number | null;
};

const issueTags = ['内容偏难', '内容偏浅', '节奏过快', '节奏过慢', '案例不足', '实操不足', '设备问题', '场地问题', '其他'];
const emptyFeedback: FeedbackDraft = {
  overallRating: 5,
  contentRating: 5,
  trainerRating: 5,
  practicalValueRating: 5,
  issueTags: [],
  comment: '',
  followUpRequested: false,
  version: null,
};

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function timeRemaining(target: string, currentTime: number): string {
  const seconds = Math.max(0, Math.floor((new Date(target).getTime() - currentTime) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}小时 ${minutes}分`;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function statusText(status: string): string {
  return ({
    PRESENT: '签到成功',
    LATE: '迟到签到',
    ABSENT: '缺勤',
    LEAVE: '请假',
    INVITED: '待签到',
    SCHEDULED: '尚未开放',
    OPEN: '正在开放',
    EXPIRED: '已经过期',
    CLOSED: '已经关闭',
    REVOKED: '已经作废',
  } as Record<string, string>)[status] || status;
}

function Rating({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <fieldset className="training-scan-rating">
    <legend>{label}</legend>
    <div>{[1, 2, 3, 4, 5].map(score => <button
      type="button"
      key={score}
      className={score <= value ? 'active' : ''}
      aria-label={`${label} ${score} 分`}
      aria-pressed={score === value}
      onClick={() => onChange(score)}
    ><Star aria-hidden="true" /><span>{score}</span></button>)}</div>
  </fieldset>;
}

export default function TrainingScanMobile({ code, user }: {
  code: string;
  user: { displayName: string; employeeNo: string | null };
}) {
  const [data, setData] = useState<ScanPayload | null>(null);
  const [draft, setDraft] = useState<FeedbackDraft>(emptyFeedback);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/training-self/scan/${encodeURIComponent(code)}`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!response.ok || !body.data) throw new Error(body.error || '培训二维码读取失败');
      const payload = body.data as ScanPayload;
      setData(payload);
      setClock(new Date(payload.serverTime).getTime());
      if (payload.feedback) {
        setDraft({
          overallRating: payload.feedback.overallRating,
          contentRating: payload.feedback.contentRating,
          trainerRating: payload.feedback.trainerRating,
          practicalValueRating: payload.feedback.practicalValueRating,
          issueTags: payload.feedback.issueTags,
          comment: payload.feedback.comment || '',
          followUpRequested: payload.feedback.followUpRequested,
          version: payload.feedback.version,
        });
      } else setDraft({ ...emptyFeedback });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '培训二维码读取失败');
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(current => current + 1000), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const windowOpen = data?.window.status === 'OPEN';
  const alreadyCheckedIn = data?.attendance && ['PRESENT', 'LATE'].includes(data.attendance.status);
  const feedbackEligible = Boolean(data?.attendance && ['PRESENT', 'LATE'].includes(data.attendance.status));
  const deadlineText = useMemo(() => data ? timeRemaining(
    data.window.status === 'SCHEDULED' ? data.window.opensAt : data.window.expiresAt,
    clock,
  ) : '', [clock, data]);

  async function checkIn() {
    if (!data || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/training-self/scan/${encodeURIComponent(code)}/check-in`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error || '签到失败');
      setData(body.data as ScanPayload);
      setNotice(body.data.idempotent ? '你已经完成签到，本次没有重复记录。' : '签到已记录，以系统显示时间为准。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '签到失败');
    } finally {
      setSaving(false);
    }
  }

  async function submitFeedback(event: React.FormEvent) {
    event.preventDefault();
    if (!data || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/training-self/scan/${encodeURIComponent(code)}/feedback`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.data) throw new Error(body.error || '反馈保存失败');
      const payload = body.data as ScanPayload;
      setData(payload);
      if (payload.feedback) setDraft(current => ({ ...current, version: payload.feedback!.version }));
      setNotice('课后反馈已保存，在截止时间前仍可修改。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '反馈保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    if (saving) return;
    setSaving(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  if (loading && !data) return <main className="training-scan-page"><section className="training-scan-loading"><Loader2 className="spin" /><strong>正在读取培训二维码</strong><span>核对课次、账号和开放时间…</span></section></main>;
  if (!data) return <main className="training-scan-page"><section className="training-scan-error"><AlertTriangle /><strong>无法打开培训二维码</strong><p>{error || '二维码无效或已经失效'}</p><button type="button" onClick={() => void load()}><RefreshCw />重新读取</button></section></main>;

  return <main className="training-scan-page">
    <header className="training-scan-header">
      <span><GraduationCap /></span>
      <div><small>人事管理 · 培训发展</small><strong>{data.purpose === 'CHECK_IN' ? '培训签到' : '课后反馈'}</strong></div>
      <button type="button" aria-label="退出登录" disabled={saving} onClick={() => void logout()}><LogOut /></button>
    </header>

    <section className="training-scan-course">
      <div className="training-scan-course-kicker"><span>{data.plan.code}</span><em>{statusText(data.window.status)}</em></div>
      <h1>{data.plan.title}</h1>
      <strong>{data.session.name}</strong>
      <dl>
        <div><CalendarClock /><span><dt>培训时间</dt><dd>{formatDate(data.session.startAt)}—{new Date(data.session.endAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })}</dd></span></div>
        <div><MapPin /><span><dt>培训地点</dt><dd>{data.session.location || '地点待确认'}</dd></span></div>
        <div><UserRoundCheck /><span><dt>当前账号</dt><dd>{data.participant.employeeNo} · {data.participant.employeeName}</dd></span></div>
      </dl>
    </section>

    <section className={`training-scan-window ${data.window.status.toLowerCase()}`}>
      <Clock3 />
      <div><small>{data.window.status === 'SCHEDULED' ? '距离开放' : '距离截止'}</small><strong>{deadlineText}</strong><span>{data.window.status === 'SCHEDULED' ? formatDate(data.window.opensAt) : formatDate(data.window.expiresAt)}</span></div>
      <em>{statusText(data.window.status)}</em>
    </section>

    {error && <div className="training-scan-alert error"><AlertTriangle />{error}</div>}
    {notice && <div className="training-scan-alert success"><CheckCircle2 />{notice}</div>}

    {data.purpose === 'CHECK_IN' && <section className="training-scan-action-card">
      {alreadyCheckedIn ? <div className="training-scan-success-state">
        <span><Check /></span>
        <small>{data.attendance?.status === 'LATE' ? '迟到签到' : '签到成功'}</small>
        <strong>{formatDate(data.attendance?.checkInAt || null)}</strong>
        <p>记录已经保存，重复扫码不会产生第二条签到。</p>
      </div> : <>
        <ClipboardCheck />
        <h2>确认本人签到</h2>
        <p>签到采用当前个人账号和服务器时间，不能代他人选择姓名。</p>
        <button type="button" className="training-scan-primary" disabled={!windowOpen || saving} onClick={() => void checkIn()}>
          {saving ? <Loader2 className="spin" /> : <Check />} {saving ? '正在签到…' : windowOpen ? '确认签到' : statusText(data.window.status)}
        </button>
      </>}
    </section>}

    {data.purpose === 'FEEDBACK' && !feedbackEligible && <section className="training-scan-action-card">
      <AlertTriangle />
      <h2>暂不能提交课后反馈</h2>
      <p>当前课次出勤状态为“{statusText(data.attendance?.status || 'INVITED')}”。只有本人已签到或迟到签到后才能提交反馈；如记录有误，请联系培训负责人更正。</p>
    </section>}

    {data.purpose === 'FEEDBACK' && feedbackEligible && <form className="training-scan-feedback" onSubmit={submitFeedback}>
      <header><MessageSquareText /><div><small>约一分钟完成</small><h2>课程体验反馈</h2><p>提交状态用于去重和提醒，统计页面默认优先展示汇总结果。</p></div></header>
      <Rating label="整体满意度" value={draft.overallRating} onChange={value => setDraft(current => ({ ...current, overallRating: value }))} />
      <Rating label="课程内容" value={draft.contentRating} onChange={value => setDraft(current => ({ ...current, contentRating: value }))} />
      <Rating label="讲师表现" value={draft.trainerRating} onChange={value => setDraft(current => ({ ...current, trainerRating: value }))} />
      <Rating label="实用程度" value={draft.practicalValueRating} onChange={value => setDraft(current => ({ ...current, practicalValueRating: value }))} />
      <fieldset className="training-scan-tags"><legend>需要改进的方面（可多选）</legend><div>{issueTags.map(tag => <button type="button" key={tag} aria-pressed={draft.issueTags.includes(tag)} className={draft.issueTags.includes(tag) ? 'active' : ''} onClick={() => setDraft(current => ({ ...current, issueTags: current.issueTags.includes(tag) ? current.issueTags.filter(item => item !== tag) : [...current.issueTags, tag] }))}>{tag}</button>)}</div></fieldset>
      <label className="training-scan-comment"><span>改进建议（选填）</span><textarea maxLength={2000} value={draft.comment} onChange={event => setDraft(current => ({ ...current, comment: event.target.value }))} placeholder="哪些内容最有帮助？还有哪里可以改进？" /><small>{draft.comment.length}/2000</small></label>
      <label className="training-scan-follow-up"><input type="checkbox" checked={draft.followUpRequested} onChange={event => setDraft(current => ({ ...current, followUpRequested: event.target.checked }))} /><span><strong>希望进一步沟通或辅导</strong><small>勾选后培训负责人可以联系我跟进。</small></span></label>
      <button type="submit" className="training-scan-primary" disabled={!windowOpen || saving}>{saving ? <Loader2 className="spin" /> : <Send />}{saving ? '正在保存…' : data.feedback ? '更新反馈' : '提交反馈'}</button>
      {data.feedback && <p className="training-scan-saved"><CheckCircle2 />上次保存：{formatDate(data.feedback.updatedAt)}</p>}
    </form>}

    <footer className="training-scan-footer"><strong>{user.displayName}</strong><span>{user.employeeNo || '账号已登录'} · 本页只操作你的培训记录</span></footer>
  </main>;
}
