'use client';

import { useState } from 'react';
import { PreviewModal } from '@/components/PdfViewer';

type ImageMode = 'fit' | 'original' | 'zoom';

export function ImageViewer({ fileId, title, contentUrl }: { fileId: string; title: string; contentUrl?: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const source = contentUrl || `/api/resource-files/${fileId}/content`;

  return (
    <>
      <ImageCanvas source={source} title={title} onFullscreen={() => setFullscreen(true)} />
      {fullscreen && (
        <PreviewModal title={title} onClose={() => setFullscreen(false)}>
          <ImageCanvas source={source} title={title} fullscreen onClose={() => setFullscreen(false)} />
        </PreviewModal>
      )}
    </>
  );
}

function ImageCanvas({
  source,
  title,
  fullscreen = false,
  onFullscreen,
  onClose,
}: {
  source: string;
  title: string;
  fullscreen?: boolean;
  onFullscreen?: () => void;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<ImageMode>('fit');
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  function updateZoom(delta: number) {
    setMode('zoom');
    setZoom(v => Math.max(0.35, Math.min(3, v + delta)));
  }

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
          <button type="button" onClick={() => setMode('fit')}>适应窗口</button>
          <button type="button" onClick={() => { setMode('original'); setZoom(1); }}>原始大小</button>
          {fullscreen ? <button className="viewer-close-button" type="button" onClick={onClose}>关闭</button> : <button type="button" onClick={onFullscreen}>全屏</button>}
        </div>
      </div>
      <div className="viewer-stage image-stage">
        {loading && <ViewerState title="图片加载中" detail="正在读取同源文件流" />}
        {error && <ViewerState title="图片加载失败" detail="请刷新页面或下载原文件查看" error />}
        <img
          className={`preview-image ${mode}`}
          src={source}
          alt={title}
          style={mode === 'zoom' ? { transform: `scale(${zoom})` } : undefined}
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

function ViewerState({ title, detail, error = false }: { title: string; detail: string; error?: boolean }) {
  return (
    <div className={error ? 'viewer-state error' : 'viewer-state'}>
      <span />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
