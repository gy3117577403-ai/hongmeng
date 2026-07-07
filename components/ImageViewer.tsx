'use client';

import { useEffect, useState } from 'react';
import { PreviewModal } from '@/components/PdfViewer';

type ImageMode = 'fit' | 'original' | 'zoom';

export function ImageViewer({ fileId, title, contentUrl, downloadUrl }: { fileId: string; title: string; contentUrl?: string; downloadUrl?: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const source = contentUrl || `/api/resource-files/${fileId}/content`;
  const fallbackDownloadUrl = downloadUrl || `/api/resource-files/${fileId}/download`;

  return (
    <>
      <ImageCanvas source={source} title={title} downloadUrl={fallbackDownloadUrl} onFullscreen={() => setFullscreen(true)} />
      {fullscreen && (
        <PreviewModal title={title} onClose={() => setFullscreen(false)}>
          <ImageCanvas source={source} title={title} downloadUrl={fallbackDownloadUrl} fullscreen onClose={() => setFullscreen(false)} />
        </PreviewModal>
      )}
    </>
  );
}

function ImageCanvas({
  source,
  title,
  downloadUrl,
  fullscreen = false,
  onFullscreen,
  onClose,
}: {
  source: string;
  title: string;
  downloadUrl: string;
  fullscreen?: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<ImageMode>('fit');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const displaySource = reloadKey > 0 ? `${source}${source.includes('?') ? '&' : '?'}reload=${reloadKey}` : source;

  useEffect(() => {
    setLoading(true);
    setError(false);
    setZoom(1);
    setMode('fit');
    setRotation(0);
  }, [source, reloadKey]);

  function updateZoom(delta: number) {
    setMode('zoom');
    setZoom(v => Math.max(0.35, Math.min(3, v + delta)));
  }

  function rotate(delta: number) {
    setRotation(value => (value + delta + 360) % 360);
  }

  const transformParts = [`rotate(${rotation}deg)`];
  if (mode === 'zoom') transformParts.push(`scale(${zoom})`);
  const imageTransform = transformParts.join(' ');

  return (
    <div className={fullscreen ? 'image-viewer fullscreen-viewer' : 'image-viewer'}>
      <div className="viewer-toolbar image-toolbar">
        <div className="viewer-title" title={title}>
          <span>IMG</span>
          <strong>{title}</strong>
        </div>
        <div className="viewer-controls">
          <button type="button" onClick={() => updateZoom(-0.15)}>-</button>
          <button type="button" onClick={() => updateZoom(0.15)}>+</button>
          <button type="button" onClick={() => rotate(-90)}>左旋</button>
          <button type="button" onClick={() => rotate(90)}>右旋</button>
          <button type="button" disabled={rotation === 0} onClick={() => setRotation(0)}>重置</button>
          <button type="button" onClick={() => setMode('fit')}>适应窗口</button>
          <button type="button" onClick={() => { setMode('original'); setZoom(1); }}>原始大小</button>
          {fullscreen ? <button className="viewer-close-button" type="button" onClick={onClose}>关闭</button> : <button type="button" onClick={onFullscreen}>全屏</button>}
        </div>
      </div>
      <div className="viewer-stage image-stage">
        {loading && <ViewerState title="图片加载中" detail="正在读取同源文件流" />}
        {error && <ViewerState title="图片加载失败" detail="图片加载失败，可重新加载或下载原图" error onReload={() => setReloadKey(v => v + 1)} downloadUrl={downloadUrl} />}
        <img
          key={`${source}-${reloadKey}`}
          className={`preview-image ${mode} ${rotation % 180 === 0 ? '' : 'rotated'}`}
          src={displaySource}
          alt={title}
          loading="lazy"
          decoding="async"
          style={{ transform: imageTransform }}
          onLoad={() => {
            setLoading(false);
            setError(false);
          }}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
        />
      </div>
    </div>
  );
}

function ViewerState({ title, detail, error = false, onReload, downloadUrl }: { title: string; detail: string; error?: boolean; onReload?: () => void; downloadUrl?: string }) {
  return (
    <div className={error ? 'viewer-state error' : 'viewer-state'}>
      <span />
      <strong>{title}</strong>
      <p>{detail}</p>
      {error && (
        <div className="viewer-state-actions">
          {onReload && <button type="button" onClick={onReload}>重新加载</button>}
          {downloadUrl && <a href={downloadUrl} target="_blank" rel="noreferrer">下载原图</a>}
        </div>
      )}
    </div>
  );
}
