'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CurrentUserDTO, ResourceCategoryDTO, ResourceFileDTO, WorkOrderDTO } from '@/types';

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const k = n / 1024;
  if (k < 1024) return `${k.toFixed(1)} KB`;
  return `${(k / 1024).toFixed(2)} MB`;
}

function dt(v: string, withTime = true) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!withTime) return day;
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function shortName(name: string) {
  return name.length > 20 ? `${name.slice(0, 10)}...${name.slice(-7)}` : name;
}

const priorityText: Record<string, string> = { urgent: '紧急', high: '高', normal: '一般' };
const categoryIcons: Record<string, string> = { drawing: '原', sop: 'SOP', product: '成', material: '辅', notice: '注' };
const fileTypeText: Record<string, string> = { pdf: 'PDF', jpg: 'JPG', png: 'PNG' };
const statusText: Record<string, string> = { uploaded: '已上传', deleted: '已删除' };

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
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [lib, setLib] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [deleteTarget, setDeleteTarget] = useState<ResourceFileDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  const pdf = useRef<HTMLInputElement>(null);
  const img = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const text = kw.trim().toLowerCase();
    if (!text) return orders;
    return orders.filter(o => o.code.toLowerCase().includes(text) || o.productName.toLowerCase().includes(text));
  }, [orders, kw]);

  const order = orders.find(o => o.id === wo) || orders[0];
  const category = categories.find(c => c.id === cat) || categories[0];
  const file = files.find(f => f.id === sel) || files[0];
  const accountName = user.displayName || user.username;
  const completedCategories = categories.filter(c => (categoryCounts[c.id] || 0) > 0).length;
  const completionText = categories.length ? `${completedCategories}/${categories.length} 类完整` : '未配置分类';
  const visibleToday = list.slice(0, Math.min(3, list.length));
  const visibleWeek = list.slice(Math.min(3, list.length));

  async function loadFiles(w = order?.id, c = category?.id, preferredFileId?: string) {
    if (!w || !c) return [];
    setLoading(true);
    try {
      const r = await fetch(`/api/resource-files?workOrderId=${w}&categoryId=${c}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('load files failed');
      const d = await r.json();
      const nextFiles: ResourceFileDTO[] = Array.isArray(d.files) ? d.files : [];
      setFiles(nextFiles);
      setSel(preferredFileId && nextFiles.some(f => f.id === preferredFileId) ? preferredFileId : nextFiles[0]?.id || '');
      setCategoryCounts(v => ({ ...v, [c]: nextFiles.length }));
      return nextFiles;
    } catch {
      setMsg('文件加载失败，请检查网络后重试');
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function loadCategoryCounts(w = order?.id) {
    if (!w) return;
    try {
      const pairs = await Promise.all(
        categories.map(async c => {
          const r = await fetch(`/api/resource-files?workOrderId=${w}&categoryId=${c.id}`, { cache: 'no-store' });
          if (!r.ok) return [c.id, 0] as const;
          const d = await r.json();
          return [c.id, Array.isArray(d.files) ? d.files.length : 0] as const;
        }),
      );
      setCategoryCounts(Object.fromEntries(pairs));
    } catch {
      setCategoryCounts({});
    }
  }

  useEffect(() => {
    loadFiles(order?.id, category?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo, cat]);

  useEffect(() => {
    loadCategoryCounts(order?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wo]);

  async function upload(f?: File | null) {
    if (!f || !order || !category) return;
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (!ext || !['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) {
      setMsg('格式不支持，仅支持 PDF、JPG、PNG');
      return;
    }

    setUploading(true);
    setMsg('上传中，请稍候');
    const fd = new FormData();
    fd.append('file', f);
    fd.append('workOrderId', order.id);
    fd.append('categoryId', category.id);
    fd.append('version', 'V1.0');

    try {
      const r = await fetch('/api/resource-files/upload', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d.message || '上传失败，请稍后重试');
        return;
      }
      await loadFiles(order.id, category.id, d.file?.id);
      await loadCategoryCounts(order.id);
      setMsg('上传成功');
    } catch {
      setMsg('上传失败，对象存储或网络异常');
    } finally {
      setUploading(false);
      if (pdf.current) pdf.current.value = '';
      if (img.current) img.current.value = '';
    }
  }

  async function refresh() {
    try {
      const r = await fetch('/api/work-orders', { cache: 'no-store' });
      if (!r.ok) throw new Error('refresh failed');
      const d = await r.json();
      setOrders(d.workOrders);
      await loadFiles();
      await loadCategoryCounts();
      setMsg('已刷新');
    } catch {
      setMsg('刷新失败，请稍后重试');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/resource-files/${deleteTarget.id}/delete`, { method: 'POST' });
      if (!r.ok) {
        setMsg('删除失败，请稍后重试');
        return;
      }
      setMsg('删除成功');
      setDeleteTarget(null);
      await loadFiles();
      await loadCategoryCounts();
    } catch {
      setMsg('网络错误，删除失败');
    } finally {
      setDeleting(false);
    }
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
        <button className="home-button" type="button" aria-label="首页">⌂</button>
        <div className="brand-block">
          <strong>工单资料库</strong>
          <span>鸿蒙平板生产资料管理系统</span>
        </div>
        <div className="top-search">
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索工单号 / 产品名称" />
          <b>⌕</b>
        </div>
        <div className="top-actions">
          <button className="notice-button" type="button" aria-label="通知">◇<span /></button>
          <button className="language-button" type="button">CN</button>
          <div className="library-wrap">
            <button className="library-button" type="button" onClick={() => setLib(!lib)}>▱ 资料库</button>
            {lib && (
              <div className="library-menu">
                <button type="button">⚒ 治具资料</button>
                <button className="active" type="button">▤ 生产资料 ✓</button>
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
        </div>
      </header>

      <section className="workspace">
        <aside className="orders-panel">
          <div className="panel-head">
            <div>
              <span>生产工单</span>
              <strong>{list.length} 单</strong>
            </div>
            <button type="button" onClick={refresh}>刷新</button>
          </div>
          <div className="order-stats">
            <div><span>今日订单</span><strong>{visibleToday.length}</strong></div>
            <div><span>本周订单</span><strong>{list.length}</strong></div>
          </div>
          <OrderGroup title="今日订单" orders={visibleToday} selected={order?.id} choose={setWo} />
          <OrderGroup title="本周订单" orders={visibleWeek} selected={order?.id} choose={setWo} />
          {!list.length && <div className="empty-orders large">未找到匹配工单</div>}
        </aside>

        <nav className="resource-menu">
          <div className="resource-head">
            <strong>资料分类</strong>
            <span>{completionText}</span>
          </div>
          {categories.map(c => {
            const count = categoryCounts[c.id] || 0;
            return (
              <button key={c.id} className={c.id === category?.id ? 'active' : ''} type="button" onClick={() => setCat(c.id)}>
                <span className="category-mark">{categoryIcons[c.code] || c.name.slice(0, 1)}</span>
                <b>{c.name}</b>
                <i className={count ? 'state-dot ok' : 'state-dot'} />
                <em>{count}</em>
              </button>
            );
          })}
          <button className="upload-manage" type="button" disabled={uploading} onClick={() => pdf.current?.click()}>
            <span className="category-mark">↑</span>
            <b>{uploading ? '上传中' : '上传管理'}</b>
          </button>
        </nav>

        <section className="main-card">
          <div className="status-title-row">
            <div className="status-title">
              <span className="doc-icon">▤</span>
              <div>
                <strong>{order?.code || '暂无工单'}</strong>
                <small>{order?.productName || '请选择工单'}</small>
              </div>
            </div>
            <div className="current-order">
              <span>{category?.name || '资料分类'}</span>
              <b>{files.length ? '资料完整' : '待上传'}</b>
            </div>
            <button className="refresh-button" type="button" onClick={refresh}>↻ 刷新</button>
          </div>

          <div className="content-grid">
            <section className="preview-card">
              <div className="preview-toolbar">
                <div>
                  <span className={file?.fileType === 'pdf' ? 'file-type mini pdf' : 'file-type mini img'}>{file ? fileTypeText[file.fileType] || file.fileType.toUpperCase() : '空'}</span>
                  <strong>{file?.originalName || '当前分类暂无文件'}</strong>
                </div>
                <div className="preview-meta">
                  {file ? <span className="ok-dot">● 已就绪</span> : <span className="missing-dot">● 缺文件</span>}
                  {file && <span>{bytes(file.fileSize)}</span>}
                  {file && <span>{dt(file.createdAt)}</span>}
                </div>
              </div>

              <div className="preview-stage">
                {loading ? (
                  <div className="preview-loading">
                    <span />
                    <strong>资料加载中</strong>
                    <p>正在读取当前分类文件</p>
                  </div>
                ) : file ? (
                  file.fileType === 'pdf' ? <iframe src={file.viewUrl} title={file.originalName} /> : <img src={file.viewUrl} alt={file.originalName} />
                ) : (
                  <div className="empty-preview">
                    <div className="empty-illustration">▤</div>
                    <strong>当前分类暂无文件</strong>
                    <p>上传后所有登录账号都可以共享查看，文件将保存到对象存储。</p>
                    <div className="empty-actions">
                      <button type="button" disabled={uploading} onClick={() => pdf.current?.click()}>上传 PDF</button>
                      <button type="button" disabled={uploading} onClick={() => img.current?.click()}>上传图片</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="file-strip" aria-label="当前分类文件列表">
                {files.length === 0 ? (
                  <div className="strip-empty">当前分类暂无文件</div>
                ) : files.map(f => (
                  <button key={f.id} className={f.id === file?.id ? 'strip-file active' : 'strip-file'} type="button" onClick={() => setSel(f.id)}>
                    <span className={f.fileType === 'pdf' ? 'file-type pdf' : 'file-type img'}>{fileTypeText[f.fileType] || f.fileType.toUpperCase()}</span>
                    <b>{shortName(f.originalName)}</b>
                    <small>{dt(f.createdAt, false)}</small>
                  </button>
                ))}
              </div>
            </section>

            <aside className="detail-column">
              <section className="file-info-card">
                <div className="file-list-header">
                  <strong>文件信息</strong>
                  <span>{files.length ? `${files.length} 个文件` : '暂无文件'}</span>
                </div>
                <Info label="文件名" value={file?.originalName || '-'} />
                <Info label="文件类型" value={file ? fileTypeText[file.fileType] || file.fileType.toUpperCase() : '-'} />
                <Info label="文件大小" value={file ? bytes(file.fileSize) : '-'} />
                <Info label="上传人" value={file?.uploadedBy || accountName} />
                <Info label="上传时间" value={file ? dt(file.createdAt) : '-'} />
                <Info label="当前分类" value={category?.name || '-'} />
                <Info label="文件状态" value={file ? statusText[file.status] || file.status : '缺失'} ok={!!file} />
              </section>

              <section className="action-card">
                <input ref={pdf} hidden type="file" accept="application/pdf,.pdf" onChange={e => upload(e.target.files?.[0])} />
                <input ref={img} hidden type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" capture="environment" onChange={e => upload(e.target.files?.[0])} />
                <button className="upload-action primary" type="button" disabled={uploading} onClick={() => pdf.current?.click()}>
                  <span>⇧</span><b>{uploading ? '上传中，请稍候' : '上传 PDF'}</b>
                </button>
                <button className="upload-action" type="button" disabled={uploading} onClick={() => img.current?.click()}>
                  <span>▣</span><b>上传图片 / 拍照</b>
                </button>
                <div className="secondary-actions">
                  <a className={!file ? 'disabled' : ''} href={file?.downloadUrl || '#'} target="_blank">下载</a>
                  <button type="button" disabled={!file} onClick={() => file && setDeleteTarget(file)}>删除</button>
                  <button type="button" onClick={copy}>复制链接</button>
                </div>
              </section>
            </aside>
          </div>
        </section>
      </section>

      {msg && <div className="status-toast">{msg}</div>}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除确认">
            <div className="dialog-title">
              <strong>确认软删除</strong>
              <button type="button" onClick={() => setDeleteTarget(null)}>×</button>
            </div>
            <p>文件将从当前资料列表移除，历史数据仍保留在数据库记录中。</p>
            <div className="delete-file-name">{deleteTarget.originalName}</div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="danger-button" type="button" disabled={deleting} onClick={confirmDelete}>{deleting ? '删除中...' : '确认删除'}</button>
            </div>
          </section>
        </div>
      )}

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
      <h2><span>▣</span>{title}<em>{orders.length}</em></h2>
      {orders.map(o => (
        <button key={o.id} className={o.id === selected ? 'order-card active' : 'order-card'} type="button" onClick={() => choose(o.id)}>
          <div className="order-topline">
            <strong>{o.code}</strong>
            <span className={`tag ${o.priority === 'urgent' ? 'tag-danger' : o.priority === 'high' ? 'tag-warning' : 'tag-blue'}`}>{priorityText[o.priority] || '一般'}</span>
          </div>
          <p>{o.productName}</p>
          <div className="order-progress">
            <span className={`stage ${o.stage === '前端' ? 'stage-blue' : o.stage === '后端' ? 'stage-green' : 'stage-gray'}`}>{o.stage}</span>
            <b>{o.progress ? `${o.progress}%` : '待开始'}</b>
            <i><em style={{ width: `${Math.min(Math.max(o.progress, 0), 100)}%` }} /></i>
          </div>
          <div className="order-status">
            <span>{o.status === 'done' ? '已完成' : o.status === 'paused' ? '暂停' : '进行中'}</span>
            <em>›</em>
          </div>
        </button>
      ))}
      {!orders.length && <div className="empty-orders">暂无工单</div>}
    </section>
  );
}

function Info({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="info-item">
      <small>{label}</small>
      <strong className={ok ? 'success-text' : ''} title={value}>{value}</strong>
    </div>
  );
}
