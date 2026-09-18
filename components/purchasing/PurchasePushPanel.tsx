"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Status = {
  enabled: boolean;
  configured: boolean;
  message: string;
  source: string;
  origin: string;
  version: number;
  canConfigure: boolean;
  rows: Array<{
    id: string;
    action: string;
    state: string;
    attempts: number;
    lastError: string;
    createdAt: string;
    sentAt: string | null;
    records: Array<{ id: string; number: string; name: string }>;
  }>;
};
const labels: Record<string, string> = {
  PENDING: "待发送",
  SENDING: "发送中",
  SENT: "已发送",
  FAILED: "发送失败",
  WAITING_CONFIG: "待配置",
  UNCERTAIN: "回执未知",
  SKIPPED: "已跳过",
};
const events: Record<string, string> = {
  SAVE_REQUEST: "提交请购",
  APPROVE_LINES: "采购通过",
  RETURN_LINES: "请购退回",
  WITHDRAW_LINES: "请购撤回",
  VOID_LINES: "采购作废",
  CREATE_FUND: "资金申请",
  APPROVE_FUNDS: "资金通过",
  RETURN_FUNDS: "资金退回",
  WITHDRAW_FUND: "资金撤回",
  CLOSE_FUND: "关闭未付余额",
  TEST: "接入测试",
};
export default function PurchasePushPanel({
  record,
  onDirty,
}: {
  record?: string;
  onDirty?: (dirty: boolean) => void;
}) {
  const dirty = useRef(false);
  const [testConfirm, setTestConfirm] = useState(false);
  const changed = () => {
    dirty.current = true;
    onDirty?.(true);
  };
  const [data, setData] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [webhook, setWebhook] = useState(""),
    [origin, setOrigin] = useState(""),
    [enabled, setEnabled] = useState(true),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState<string[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        "/api/purchases/notifications" +
          (record ? "?record=" + encodeURIComponent(record) : ""),
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setData(j.data);
      if (!dirty.current) {
        setOrigin(j.data.origin);
        setEnabled(j.data.enabled);
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取推送记录失败");
    }
  }, [record]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/purchases/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setData(j.data);
      if (body.action === "SAVE_CONFIG") {
        setWebhook("");
        dirty.current = false;
        onDirty?.(false);
        setOrigin(j.data.origin);
        setEnabled(j.data.enabled);
      }
      setTestConfirm(false);
      setNotice(
        body.action === "SAVE_CONFIG"
          ? "配置已保存"
          : "已加入发送队列，后台将自动处理",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="pc-push-panel">
      <header>
        <div>
          <h3>杭连采购 · 群推送</h3>
          <p>一次提交汇总一条，处理后保留发送记录</p>
        </div>
        <button onClick={() => void load()} disabled={busy}>
          刷新记录
        </button>
      </header>
      {error && (
        <p className="pc-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="pc-inline-notice">
          {notice}
        </p>
      )}
      {!data ? (
        <p>正在读取推送状态…</p>
      ) : (
        <>
          <p className="pc-push-state">
            {!data.enabled
              ? "群推送已暂停"
              : data.configured
                ? "采购机器人已配置"
                : "等待配置采购机器人"}
            <small>{data.message || data.source}</small>
          </p>
          {!record && data.canConfigure && (
            <div className="pc-form-grid">
              <label className="pc-field pc-wide">
                <span>采购群机器人 Webhook（留空保留已保存配置）</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={webhook}
                  placeholder="粘贴企业微信群机器人地址"
                  onChange={(e) => {
                    setWebhook(e.target.value);
                    changed();
                  }}
                />
              </label>
              <label className="pc-field pc-wide">
                <span>正式站点根地址</span>
                <input
                  type="url"
                  value={origin}
                  placeholder="https://你的正式站点域名"
                  onChange={(e) => {
                    setOrigin(e.target.value);
                    changed();
                  }}
                />
              </label>
              <label className="pc-check">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => {
                    setEnabled(e.target.checked);
                    changed();
                  }}
                />
                启用采购群推送
              </label>
              <div className="pc-actions pc-wide">
                <button
                  className="pc-primary"
                  disabled={busy}
                  onClick={() =>
                    void act({
                      action: "SAVE_CONFIG",
                      version: data.version,
                      webhook,
                      origin,
                      enabled,
                    })
                  }
                >
                  保存推送配置
                </button>
                <button
                  disabled={busy || !data.configured || !data.enabled}
                  onClick={() => setTestConfirm(true)}
                >
                  向群发送测试消息
                </button>
              </div>
              {testConfirm && (
                <div
                  className="pc-wide pc-push-state"
                  role="group"
                  aria-label="确认测试消息"
                >
                  <p>
                    将使用已保存的配置向采购群发送一条“杭连采购｜推送连接测试”，明确标注无需审批。
                  </p>
                  <div className="pc-actions">
                    <button
                      disabled={busy}
                      onClick={() => setTestConfirm(false)}
                    >
                      取消测试
                    </button>
                    <button
                      className="pc-primary"
                      disabled={busy}
                      onClick={() => void act({ action: "TEST" })}
                    >
                      确认发送测试
                    </button>
                  </div>
                </div>
              )}
              <p className="pc-muted pc-wide">
                未配置成员身份时展示姓名，站内待办正常保留。群消息不会执行审批。
              </p>
            </div>
          )}
          <h3>最近发送记录</h3>
          {!data.rows.length && (
            <p className="pc-empty">
              暂时没有推送记录，正式提交请购后会在这里显示。
            </p>
          )}
          {data.rows.map((row) => (
            <article className="pc-push-row" key={row.id}>
              <div>
                <b>{events[row.action] || row.action}</b>
                <span className={"pc-badge pc-push-" + row.state.toLowerCase()}>
                  {labels[row.state]}
                </span>
              </div>
              <p>
                {row.records.slice(0, 3).map((r) => (
                  <a
                    key={r.id}
                    href={
                      "/workspace/purchases?record=" + encodeURIComponent(r.id)
                    }
                  >
                    {r.number} · {r.name}
                    <br />
                  </a>
                ))}
              </p>
              <small>
                {new Date(row.createdAt).toLocaleString("zh-CN")} · 尝试{" "}
                {row.attempts} 次
              </small>
              {row.lastError && <p>{row.lastError}</p>}
              {data.canConfigure &&
                ["FAILED", "UNCERTAIN", "WAITING_CONFIG"].includes(
                  row.state,
                ) && (
                  <div>
                    {row.state === "UNCERTAIN" && (
                      <label className="pc-check">
                        <input
                          type="checkbox"
                          checked={confirmed.includes(row.id)}
                          onChange={(e) =>
                            setConfirmed((ids) =>
                              e.target.checked
                                ? [...ids, row.id]
                                : ids.filter((id) => id !== row.id),
                            )
                          }
                        />
                        已核对群消息，确认未收到
                      </label>
                    )}
                    <button
                      disabled={
                        busy ||
                        (row.state === "UNCERTAIN" &&
                          !confirmed.includes(row.id))
                      }
                      onClick={() =>
                        void act({
                          action: "RETRY",
                          id: row.id,
                          confirmNotReceived: confirmed.includes(row.id),
                        })
                      }
                    >
                      重新排队发送
                    </button>
                  </div>
                )}
            </article>
          ))}
          <p className="pc-muted">
            已发送表示接口已接收，不代表群成员已读或已处理。
          </p>
        </>
      )}
    </section>
  );
}
