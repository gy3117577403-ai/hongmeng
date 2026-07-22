'use client';

import { AlertTriangle, CheckCircle2, CircleX, Info } from 'lucide-react';
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

type ToastOptions = {
  tone?: ToastTone;
  duration?: number;
  dedupeKey?: string;
};

type ToastItem = {
  id: string;
  dedupeKey: string;
  message: string;
  tone: ToastTone;
  leaving: boolean;
};

type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void;
};

type ToastTimers = {
  leave: number;
  remove: number;
};

const ToastContext = createContext<ToastContextValue | null>(null);
let toastSequence = 0;

function inferToastTone(message: string): ToastTone {
  if (/(失败|错误|异常|无法|不能|无效|不存在|网络断开|加载失败)/.test(message)) return 'error';
  if (/(请先|请选择|请输入|暂无|未选择|未检测|只读|需要|提醒|警告)/.test(message)) return 'warning';
  if (/(成功|完成|已保存|已更新|已创建|已恢复|已复制|已上传|已下载|已删除|已生成|已发布|已导入|已同步|已开始)/.test(message)) return 'success';
  return 'info';
}

function ToastIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') return <CheckCircle2 size={16} aria-hidden="true" />;
  if (tone === 'warning') return <AlertTriangle size={16} aria-hidden="true" />;
  if (tone === 'error') return <CircleX size={16} aria-hidden="true" />;
  return <Info size={16} aria-hidden="true" />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ToastTimers>>(new Map());
  const idsByKeyRef = useRef<Map<string, string>>(new Map());

  const clearTimers = useCallback((id: string) => {
    const timers = timersRef.current.get(id);
    if (!timers) return;
    window.clearTimeout(timers.leave);
    window.clearTimeout(timers.remove);
    timersRef.current.delete(id);
  }, []);

  const removeToast = useCallback((id: string) => {
    clearTimers(id);
    setItems(current => {
      const removed = current.find(item => item.id === id);
      if (removed && idsByKeyRef.current.get(removed.dedupeKey) === id) {
        idsByKeyRef.current.delete(removed.dedupeKey);
      }
      return current.filter(item => item.id !== id);
    });
  }, [clearTimers]);

  const showToast = useCallback((rawMessage: string, options: ToastOptions = {}) => {
    const message = rawMessage.trim();
    if (!message) return;

    const tone = options.tone || inferToastTone(message);
    const duration = Math.max(800, options.duration || 3000);
    const dedupeKey = options.dedupeKey || `${tone}:${message}`;
    const existingId = idsByKeyRef.current.get(dedupeKey);
    const id = existingId || `hm-toast-${Date.now()}-${toastSequence += 1}`;
    idsByKeyRef.current.set(dedupeKey, id);
    clearTimers(id);

    setItems(current => {
      const nextItem: ToastItem = { id, dedupeKey, message, tone, leaving: false };
      const next = [...current.filter(item => item.id !== id), nextItem];
      return next.slice(-3);
    });

    const fadeDuration = Math.min(360, Math.max(160, Math.floor(duration * 0.18)));
    const leave = window.setTimeout(() => {
      setItems(current => current.map(item => item.id === id ? { ...item, leaving: true } : item));
    }, Math.max(0, duration - fadeDuration));
    const remove = window.setTimeout(() => removeToast(id), duration);
    timersRef.current.set(id, { leave, remove });
  }, [clearTimers, removeToast]);

  useEffect(() => () => {
    timersRef.current.forEach(timers => {
      window.clearTimeout(timers.leave);
      window.clearTimeout(timers.remove);
    });
    timersRef.current.clear();
    idsByKeyRef.current.clear();
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return <ToastContext.Provider value={value}>
    {children}
    <div className="hm-toast-viewport" aria-label="系统通知">
      {items.map(item => <div
        key={item.id}
        className={`hm-toast hm-toast-${item.tone}${item.leaving ? ' is-leaving' : ''}`}
        role={item.tone === 'error' || item.tone === 'warning' ? 'alert' : 'status'}
        aria-live={item.tone === 'error' || item.tone === 'warning' ? 'assertive' : 'polite'}
        aria-atomic="true"
        title={item.message}
      >
        <ToastIcon tone={item.tone} />
        <span>{item.message}</span>
      </div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}

export function useToastBridge(
  message: string,
  setMessage: Dispatch<SetStateAction<string>>,
  tone?: ToastTone,
) {
  const { showToast } = useToast();

  useEffect(() => {
    if (!message) return;
    showToast(message, tone ? { tone } : undefined);
    setMessage('');
  }, [message, setMessage, showToast, tone]);
}
