'use client';
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, Scan, X } from 'lucide-react';
import { usePreviewGestures } from '@/components/usePreviewGestures';
import { useModalLayer } from '@/components/useModalLayer';
import { photoLabels, type LibraryPhoto } from '@/lib/sample-library';

type Props = { photos: LibraryPhoto[]; index: number; onIndex: (index: number) => void; onClose: () => void };
type ReadyImage = { url: string; width: number; height: number };
export default function SampleLibraryPhoto(props: Props) {
  // Reset on identity, before image load, not in an effect racing cached images.
  return <PhotoViewer key={props.photos[props.index].id} {...props} />;
}
function PhotoViewer({ photos, index, onIndex, onClose }: Props) {
  const photo = photos[index], stageRef = useRef<HTMLDivElement>(null), modalRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 }), [thumbnail, setThumbnail] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState<ReadyImage | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [quality, setQuality] = useState<'screen' | 'hd'>('screen');
  const [retry, setRetry] = useState(0), [compatible, setCompatible] = useState(false);
  const swipe = useRef<{ x: number; y: number; single: boolean } | null>(null);
  const natural = ready || thumbnail;
  const base = useMemo(() => {
    if (!natural.width || !natural.height || !box.width || !box.height) return { width: 0, height: 0 };
    const scale = Math.min((box.width - 36) / natural.width, (box.height - 36) / natural.height, 1);
    return { width: Math.max(1, natural.width * scale), height: Math.max(1, natural.height * scale) };
  }, [natural.width, natural.height, box.width, box.height]);
  const gestures = usePreviewGestures({ stageRef, contentSize: base, viewportSize: box, resetKey: photo.id, initialFitMode: 'fit-window' });
  useModalLayer({ open: true, layerRef: modalRef, onClose });
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const resize = () => setBox({ width: node.clientWidth, height: node.clientHeight });
    resize(); const observer = new ResizeObserver(resize); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (ready) URL.revokeObjectURL(ready.url); }, [ready]);
  useEffect(() => {
    let active = true, objectUrl = '', retained = false, timedOut = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      timedOut = true; controller.abort();
      if (active) { setLoading(false); setError('加载超时，已保留预览。请重试或使用兼容查看'); }
    }, 30000);
    setLoading(true); setError('');
    void (async () => {
      try {
        const response = await fetch('/api/sample-library/photos/' + photo.id + '?size=' + quality + '&retry=' + retry, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          const code = response.status;
          throw new Error(code === 401 ? '登录已过期，请返回后重新登录（401）' : code === 403 ? '当前登录或照片访问权限已失效（403）' : code === 404 ? '照片已删除或不可用（404）' : '照片读取失败（' + code + '），可以重试或查看原图');
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.src = objectUrl;
        if (image.decode) await image.decode();
        else await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('图片解码失败')); });
        if (!image.naturalWidth) throw new Error('图片解码失败');
        if (active && !timedOut) { retained = true; setReady({ url: objectUrl, width: image.naturalWidth, height: image.naturalHeight }); }
      } catch (reason) {
        if (active) setError(timedOut ? '加载超时，已保留预览。请重试或使用兼容查看' : reason instanceof Error && !['TypeError', 'EncodingError'].includes(reason.name) ? reason.message : '网络或图片解码失败，请重试或使用兼容查看');
      } finally {
        clearTimeout(timer);
        if (active) setLoading(false);
        if (objectUrl && !retained) URL.revokeObjectURL(objectUrl);
      }
    })();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [photo.id, quality, retry]);
  return <div className="sl-photo-view" ref={modalRef} role="dialog" aria-modal="true" aria-label="样品照片预览" tabIndex={-1} data-photo-state={error ? 'error' : loading ? 'loading' : 'ready'}>
    <header><button aria-label="关闭照片" onClick={onClose}><X /></button><span>{index + 1} / {photos.length}</span><button aria-label="旋转照片" disabled={compatible} onClick={() => gestures.rotateBy(90)}><RotateCw /></button><button aria-label="照片适屏" onClick={() => { setCompatible(false); gestures.reset(); }}><Scan /></button></header>
    <div className={'sl-photo-stage' + (compatible ? ' sl-photo-compatible' : '')} ref={stageRef}
      onDoubleClick={compatible ? undefined : gestures.onDoubleClick}
      onPointerDown={e => { if (compatible) return; if (swipe.current) swipe.current.single = false; else swipe.current = { x: e.clientX, y: e.clientY, single: true }; gestures.onPointerDown(e); }}
      onPointerMove={compatible ? undefined : gestures.onPointerMove}
      onPointerCancel={e => { swipe.current = null; gestures.onPointerCancel(e); }}
      onPointerUp={e => {
        if (compatible) return;
        const start = swipe.current; swipe.current = null; gestures.onPointerUp(e);
        if (start?.single && gestures.zoom <= gestures.fitWindowZoom * 1.05 && Math.abs(e.clientX - start.x) > 65 && Math.abs(e.clientX - start.x) > Math.abs(e.clientY - start.y) * 1.8) {
          const next = index + (e.clientX < start.x ? 1 : -1); if (photos[next]) onIndex(next);
        }
      }}>
      {compatible ? <img className="sl-photo-plain" src={'/api/sample-library/photos/' + photo.id + '?size=screen&retry=' + retry} alt={photo.caption || photo.name} onLoad={() => setError('')} onError={() => setError('兼容预览读取失败，请重试或查看原图')} />
        : <div className="sl-photo-transform" style={{ width: base.width || '100%', height: base.height || '100%', transform: 'translate(' + gestures.panX + 'px,' + gestures.panY + 'px) rotate(' + gestures.rotation + 'deg) scale(' + gestures.zoom + ')' }}>
          <img src={ready?.url || '/api/sample-library/photos/' + photo.id + '?size=thumb'} alt={photo.caption || photo.name} draggable={false}
            onLoad={e => { if (!ready) setThumbnail({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }); }}
            onError={() => { if (ready) setError('图片显示失败，请使用兼容查看'); }} />
        </div>}
      <div className="sl-photo-load-status" role="status" aria-live="polite">
        {loading && !compatible && <span>正在加载{quality === 'hd' ? '高清图' : '清晰图'}…</span>}
        {error && <div className="sl-photo-error"><strong>{error}</strong><button onClick={() => setRetry(value => value + 1)}>重新加载</button><details><summary>问题信息</summary>照片 {photo.id}<br />预览 {quality} · {Math.round(box.width)} × {Math.round(box.height)}</details></div>}
      </div>
    </div>
    <footer>
      <div className="sl-photo-actions"><button aria-pressed={quality === 'hd'} onClick={() => { setQuality('hd'); setCompatible(false); if (error) setRetry(n => n + 1); }}>查看高清</button><button aria-pressed={compatible} onClick={() => setCompatible(value => !value)}>{compatible ? '手势查看' : '兼容查看'}</button><a href={'/api/sample-library/photos/' + photo.id + '?size=original'} target="_blank" rel="noreferrer">查看原图</a></div>
      <div className="sl-photo-nav"><button disabled={!index} aria-label="上一张照片" onClick={() => onIndex(index - 1)}><ChevronLeft /></button><span>{compatible ? '普通图片模式 · 可长按图片' : '双指缩放 · 双击放大 · 放大后拖动'}</span><button disabled={index >= photos.length - 1} aria-label="下一张照片" onClick={() => onIndex(index + 1)}><ChevronRight /></button></div>
      <strong>{photo.caption || photo.name}</strong><small>{photoLabels[photo.category] || photo.category} · 上传 {new Date(photo.date).toLocaleString('zh-CN', { hour12: false })}</small>
    </footer>
  </div>;
}
