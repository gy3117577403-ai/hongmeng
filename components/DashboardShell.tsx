'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CurrentUserDTO, ResourceCategoryDTO, ResourceFileDTO, WorkOrderDTO } from '@/types';

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const k = n / 1024;
  if (k < 1024) return `${k.toFixed(1)} KB`;
  return `${(k / 1024).toFixed(2)} MB`;
}

function dt(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? v
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const pri: Record<string, string> = { urgent: '紧急', high: '高', normal: '一般' };
const icons: Record<string, string> = { drawing: '▤', sop: '▥', product: '▧', material: '⬢', notice: '⚠' };

export default function DashboardShell({
  user,
  initialWorkOrders,
  categories,
}: {
  user: CurrentUserDTO;
  initialWorkOrders: WorkOrderDTO[];
  categories: ResourceCategoryDTO[];
}) {
  const [orders, setOrders] = useState(initialWorkOrders);
  const [kw, setKw] = useState('');
  const [wo, setWo] = useState(initialWorkOrders[0]?.id || '');
  const [cat, setCat] = useState(categories[0]?.id || '');
  const [files, setFiles] = useState<ResourceFileDTO[]>([]);
  const [sel, setSel] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [lib, setLib] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const pdf = useRef<HTMLInputElement>(null);
  const img = useRef<HTMLInputElement>(null);

  const list = useMemo(
    () => orders.filter(o => !kw.trim() || o.code.toLowerCase().includes(kw.toLowerCase()) || o.productName.toLowerCase().includes(kw.toLowerCase())),
    [orders, kw],
  );
  const order = orders.find(o => o.id === wo) || orders[0];
  const category = categories.find(c => c.id === cat) || categories[0];
  const file = files.find(f => f.id === sel) || files[0];
  const accountName = user.displayName || user.username;

  async function loadFiles(w = order?.id, c = category?.id) {
    if (!w || !c) return;
    setLoading(true);
    setMsg('');
    try {
      const r = await fetch(`/api/resource-files?workOrderId=${w}&categoryId=${c}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('load files failed');
      const d = await r.json();
      setFiles(d.files);
      setSel(d.files[0]?.id || '');
    } catch {
      setMsg('文件加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles(order?.id, category?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo, cat]);

  async function upload(f?: File | null) {
    if (!f || !order || !category) return;
    setUploading(true);
    setMsg('');
    const fd = new FormData();
    fd.append('file', f);
    fd.append('workOrderId', order.id);
    fd.append('categoryId', category.id);
    fd.append('version', 'V1.0');

    try {
      const r = await fetch('/api/resource-files/upload', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.message || '上传失败');
        return;
      }
      setMsg('上传成功');
      await loadFiles(order.id, category.id);
    } catch {
      setMsg('上传异常');
    } finally {
      setUploading(false);
      if (pdf.current) pdf.current.value = '';
      if (img.current) img.current.value = '';
    }
  }

  async function refresh() {
    const r = await fetch('/api/work-orders', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      setOrders(d.workOrders);
      await loadFiles();
      setMsg('已刷新');
    }
  }

  async function del(f: ResourceFileDTO) {
    if (!confirm(`确认软删除 ${f.originalName}？`)) return;
    const r = await fetch(`/api/resource-files/${f.id}/delete`, { method: 'POST' });
    setMsg(r.ok ? '已删除' : '删除失败');
    await loadFiles();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  }

  async function copy() {
    if (!order) return;
    const u = `${location.origin}/dashboard?workOrder=${encodeURIComponent(order.code)}`;
    try {
      await navigator.clipboard.writeText(u);
      setMsg('当前工单链接已复制');
    } catch {
      setMsg(u);
    }
  }

  function openPasswordDialog() {
    setUserMenu(false);
    setPasswordError('');
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordOpen(true);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError('');

    if (!passwordForm.currentPassword) {
      setPasswordError('当前密码不能为空');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordError('新密码格式不正确，至少 6 位');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('两次密码不一致');
      return;
    }

    setPasswordSaving(true);
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordForm),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setPasswordError(d.message || '修改密码失败');
        return;
      }
      alert(d.message || '密码修改成功，请重新登录');
      location.href = '/login';
    } catch {
      setPasswordError('网络异常，请稍后重试');
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <main className="tablet-shell">
      <header className="topbar">
        <button className="home-button" type="button">⌂</button>
        <div className="notice-button">♢<span>3</span></div>
        <div className="top-search">
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索订单号 / 产品名称 / 物料编码 / 关键字" />
          <b>⌕</b>
        </div>
        <button className="language-button" type="button">◎ 简体中文⌄</button>
        <div className="library-wrap">
          <button className="library-button" type="button" onClick={() => setLib(!lib)}>▱ 资料库</button>
          {lib && (
            <div className="library-menu">
              <button type="button">⚒ 治具</button>
              <button className="active" type="button">▤ 图纸 ✓</button>
            </div>
          )}
        </div>
        <div className="user-wrap">
          <button className="user-button" type="button" onClick={() => setUserMenu(!userMenu)}>
            <span>♙</span>
            <b title={accountName}>{accountName}</b>
            <em>⌄</em>
          </button>
          {userMenu && (
            <div className="user-menu">
              <button type="button" onClick={openPasswordDialog}>修改密码</button>
              <button type="button" onClick={logout}>退出登录</button>
            </div>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className="orders-panel">
          <OrderGroup title="今日订单" orders={list.slice(0, 3)} selected={order?.id} choose={setWo} />
          <OrderGroup title="本周订单" orders={list.slice(3)} selected={order?.id} choose={setWo} />
          <button className="more-order" type="button">⌄ 展开更多订单</button>
        </aside>
        <section className="resource-layout">
          <nav className="resource-menu">
            <h2>资源状态</h2>
            {categories.map(c => (
              <button key={c.id} className={c.id === category?.id ? 'active' : ''} type="button" onClick={() => setCat(c.id)}>
                <span>{icons[c.code] || '▤'}</span>{c.name}
              </button>
            ))}
            <button className="upload-manage" type="button" onClick={() => pdf.current?.click()}>⬆ 上传管理</button>
          </nav>

          <section className="main-card">
            <div className="status-title-row">
              <div className="status-title"><span className="doc-icon">▤</span><strong>资源状态</strong></div>
              <div className="current-order">当前订单：<b>{order?.code || '-'}</b><i />{order?.productName || '-'}</div>
              <button className="refresh-button" type="button" onClick={refresh}>↻ 刷新</button>
            </div>

            <div className="content-grid">
              <section className="preview-card">
                <div className="preview-toolbar">
                  <div><span className="file-icon">▤</span><strong>{file?.originalName || `${category?.name || '资料'}未上传`}</strong></div>
                  <div className="preview-meta">
                    {file ? <span className="ok-dot">● 完整</span> : <span className="missing-dot">● 缺失</span>}
                    {file && <span>{file.version}</span>}
                  </div>
                </div>
                <div className="preview-stage">
                  {loading ? (
                    <div className="empty-preview">正在加载...</div>
                  ) : file ? (
                    file.fileType === 'pdf' ? <iframe src={file.viewUrl} title={file.originalName} /> : <img src={file.viewUrl} alt={file.originalName} />
                  ) : (
                    <div className="empty-preview">
                      <div>▤</div>
                      <strong>{category?.name || '资料'}暂无文件</strong>
                      <p>上传后所有登录账号都可以共享查看。</p>
                    </div>
                  )}
                </div>
                <div className="file-dots"><span className="active" /><span /><span /><span /><span /></div>
              </section>

              <aside className="file-list-card">
                <div className="file-list-header"><strong>已上传文件</strong><span>{files.length ? `${files.length} 个文件` : '暂无文件'}</span></div>
                <div className="file-list">
                  {files.length === 0 ? (
                    <div className="empty-list">当前分类暂无文件</div>
                  ) : files.map(f => (
                    <button key={f.id} className={f.id === file?.id ? 'file-row active' : 'file-row'} type="button" onClick={() => setSel(f.id)}>
                      <span className={f.fileType === 'pdf' ? 'file-type pdf' : 'file-type img'}>{f.fileType.toUpperCase()}</span>
                      <span className="file-row-main"><b>{f.originalName}</b><small>{bytes(f.fileSize)} · {dt(f.createdAt)}</small></span>
                    </button>
                  ))}
                </div>
              </aside>
            </div>

            <section className="info-card">
              <Info icon="▤" label="文件类型" value={file?.fileType?.toUpperCase() || '-'} />
              <Info icon="▱" label="更新时间" value={file ? dt(file.updatedAt) : '-'} />
              <Info icon="▧" label="文件大小" value={file ? bytes(file.fileSize) : '-'} />
              <Info icon="◇" label="版本" value={file?.version || '-'} />
              <Info icon="▣" label="文件是否完整" value={files.length ? '完整' : '缺失'} ok={!!files.length} />
              <Info icon="♙" label="上传人" value={file?.uploadedBy || accountName} />
            </section>

            <section className="action-row">
              <input ref={pdf} hidden type="file" accept="application/pdf,.pdf" onChange={e => upload(e.target.files?.[0])} />
              <input ref={img} hidden type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" capture="environment" onChange={e => upload(e.target.files?.[0])} />
              <button className="upload-action" type="button" disabled={uploading} onClick={() => pdf.current?.click()}>
                <span>⇧</span><b>{uploading ? '上传中...' : '上传PDF'}</b><small>支持PDF格式，单个文件≤50MB</small>
              </button>
              <button className="upload-action" type="button" disabled={uploading} onClick={() => img.current?.click()}>
                <span>▣</span><b>拍照上传</b><small>拍摄图纸或文档，自动保存上传</small>
              </button>
            </section>

            <section className="secondary-actions">
              {file && (
                <>
                  <a href={file.downloadUrl} target="_blank">下载当前文件</a>
                  <button type="button" onClick={() => del(file)}>软删除</button>
                </>
              )}
              <button type="button" onClick={copy}>分享当前工单链接</button>
              <span>{msg}</span>
            </section>
          </section>
        </section>
      </section>

      {passwordOpen && (
        <div className="modal-backdrop" role="presentation">
          <form className="password-dialog" onSubmit={changePassword}>
            <div className="dialog-title">
              <strong>修改密码</strong>
              <button type="button" onClick={() => setPasswordOpen(false)}>×</button>
            </div>
            <label>当前密码<input type="password" value={passwordForm.currentPassword} onChange={e => setPasswordForm(v => ({ ...v, currentPassword: e.target.value }))} autoFocus /></label>
            <label>新密码<input type="password" value={passwordForm.newPassword} onChange={e => setPasswordForm(v => ({ ...v, newPassword: e.target.value }))} /></label>
            <label>确认新密码<input type="password" value={passwordForm.confirmPassword} onChange={e => setPasswordForm(v => ({ ...v, confirmPassword: e.target.value }))} /></label>
            {passwordError && <div className="form-error">{passwordError}</div>}
            <div className="dialog-actions">
              <button type="button" onClick={() => setPasswordOpen(false)}>取消</button>
              <button className="primary-button" type="submit" disabled={passwordSaving}>{passwordSaving ? '保存中...' : '保存'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function OrderGroup({
  title,
  orders,
  selected,
  choose,
}: {
  title: string;
  orders: WorkOrderDTO[];
  selected?: string;
  choose: (id: string) => void;
}) {
  return (
    <section className="order-group">
      <h2><span>▣</span>{title}<em>⌃</em></h2>
      {orders.map(o => (
        <button key={o.id} className={o.id === selected ? 'order-card active' : 'order-card'} type="button" onClick={() => choose(o.id)}>
          <div className="order-topline">
            <strong>{o.code}</strong>
            <span className={`tag ${o.priority === 'urgent' ? 'tag-danger' : o.priority === 'high' ? 'tag-warning' : 'tag-blue'}`}>{pri[o.priority] || '一般'}</span>
          </div>
          <p>{o.productName}</p>
          <div className="order-progress">
            <span className={`stage ${o.stage === '前端' ? 'stage-blue' : o.stage === '后端' ? 'stage-green' : 'stage-gray'}`}>{o.stage}</span>
            <b>{o.progress ? `${o.progress}%` : '待开始'}</b>
            <i><em style={{ width: `${o.progress}%` }} /></i>
            <span className="arrow">›</span>
          </div>
        </button>
      ))}
      {!orders.length && <div className="empty-orders">暂无订单</div>}
    </section>
  );
}

function Info({ icon, label, value, ok }: { icon: string; label: string; value: string; ok?: boolean }) {
  return (
    <div className="info-item">
      <span>{icon}</span>
      <div><small>{label}</small><strong className={ok ? 'success-text' : ''}>{value}</strong></div>
    </div>
  );
}
