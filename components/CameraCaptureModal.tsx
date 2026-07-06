'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isAndroidWebView } from '@/lib/client-platform';

type CaptureItem = { file: File; url: string };
type CameraStatus = 'requesting' | 'live' | 'captured' | 'fallback' | 'error' | 'uploading';

type CameraCaptureModalProps = {
  open: boolean;
  workOrderCode?: string;
  categoryCode?: string;
  categoryName?: string;
  onClose: () => void;
  onUpload: (files: File[]) => Promise<void> | void;
};

function safePart(value?: string) {
  return String(value || 'UNKNOWN')
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+=`]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'UNKNOWN';
}

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function photoName(workOrderCode?: string, categoryCode?: string) {
  return `workorder-camera-${safePart(workOrderCode)}-${safePart(categoryCode)}-${stamp()}.jpg`;
}

function cameraErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: string }).name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return '摄像头权限被拒绝，可使用“上传图片”选择照片。';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '未检测到可用摄像头，可使用“上传图片”选择照片。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '摄像头暂时不可用，请关闭其他占用摄像头的应用后重试。';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return '后置摄像头不可用，已尝试切换到可用摄像头。';
  return '摄像头启动失败，可使用“上传图片”选择照片。';
}

export function CameraCaptureModal({
  open,
  workOrderCode,
  categoryCode,
  categoryName,
  onClose,
  onUpload,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('requesting');
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [latest, setLatest] = useState<CaptureItem | null>(null);
  const [queue, setQueue] = useState<CaptureItem[]>([]);

  const canUseCamera = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return !!navigator.mediaDevices?.getUserMedia;
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function clearCaptures() {
    if (latest) URL.revokeObjectURL(latest.url);
    queue.forEach(item => URL.revokeObjectURL(item.url));
    setLatest(null);
    setQueue([]);
  }

  async function enumerateCameras(selected?: string) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const next = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      setDevices(next);
      if (!selected && next[0]?.deviceId) setDeviceId(next[0].deviceId);
    } catch {
      setDevices([]);
    }
  }

  async function startCamera(nextDeviceId = deviceId) {
    if (!canUseCamera) {
      setStatus('fallback');
      setError(isAndroidWebView() ? '当前设备无法直接拍照，请使用上传图片。' : '当前浏览器不支持直接调用摄像头，可使用下方拍照文件选择。');
      return;
    }
    stopStream();
    setError('');
    setStatus('requesting');
    const preferred: MediaStreamConstraints = {
      video: nextDeviceId
        ? { deviceId: { exact: nextDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    };
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(preferred);
      } catch (firstError) {
        if (nextDeviceId) throw firstError;
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      const trackDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || nextDeviceId || '';
      if (trackDeviceId) setDeviceId(trackDeviceId);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      await enumerateCameras(trackDeviceId);
      setStatus('live');
    } catch (e) {
      setError(cameraErrorMessage(e));
      setStatus('error');
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    setStatus('requesting');
    setError('');
    startCamera();
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError('摄像头画面尚未准备好，请稍候再拍照。');
      return;
    }
    const maxWidth = 1920;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('当前浏览器无法生成照片，请使用上传图片。');
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) {
      setError('照片生成失败，请重试或使用上传图片。');
      return;
    }
    stopStream();
    const file = new File([blob], photoName(workOrderCode, categoryCode), { type: 'image/jpeg', lastModified: Date.now() });
    setLatest({ file, url: URL.createObjectURL(blob) });
    setStatus('captured');
  }

  function retake() {
    if (latest) URL.revokeObjectURL(latest.url);
    setLatest(null);
    startCamera(deviceId);
  }

  function continueCapture() {
    if (latest) {
      setQueue(v => [...v, latest]);
      setLatest(null);
    }
    startCamera(deviceId);
  }

  async function confirmUpload(files?: File[]) {
    const selected = files || [...queue.map(item => item.file), ...(latest ? [latest.file] : [])];
    if (!selected.length) {
      setError('请先拍照或选择照片。');
      return;
    }
    setStatus('uploading');
    stopStream();
    await onUpload(selected);
    clearCaptures();
    onClose();
  }

  function close() {
    stopStream();
    clearCaptures();
    onClose();
  }

  async function switchCamera() {
    if (devices.length < 2) return;
    const index = devices.findIndex(d => d.deviceId === deviceId);
    const next = devices[(index + 1 + devices.length) % devices.length];
    if (next?.deviceId) {
      setDeviceId(next.deviceId);
      await startCamera(next.deviceId);
    }
  }

  return (
    <div className="camera-modal-backdrop" role="presentation">
      <section className="camera-dialog" role="dialog" aria-modal="true" aria-label="拍照上传">
        <div className="dialog-title">
          <div>
            <strong>拍照上传</strong>
            <small>{workOrderCode || '未选择工单'} · {categoryName || categoryCode || '未选择分类'}</small>
          </div>
          <button type="button" onClick={close}>×</button>
        </div>

        <div className={`camera-preview ${status}`}>
          {status === 'captured' && latest ? (
            <img src={latest.url} alt="拍照结果预览" loading="lazy" decoding="async" />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted />
          )}
          {status === 'requesting' && <div className="camera-overlay">正在请求摄像头权限...</div>}
          {(status === 'fallback' || status === 'error') && (
            <div className="camera-fallback">
              <strong>{status === 'fallback' ? '浏览器不支持直接拍照' : '摄像头不可用'}</strong>
              <p>{error}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e => {
                  const selected = Array.from(e.target.files || []);
                  e.currentTarget.value = '';
                  confirmUpload(selected);
                }}
              />
            </div>
          )}
          {status === 'uploading' && <div className="camera-overlay">正在加入上传队列...</div>}
        </div>

        {error && status !== 'fallback' && status !== 'error' && <div className="form-error">{error}</div>}

        <div className="camera-meta">
          <span>已拍 {queue.length + (latest ? 1 : 0)} 张</span>
          <span>JPEG · 最大宽度 1920 · 不保存视频流</span>
        </div>

        <div className="camera-actions">
          {status === 'live' && (
            <>
              <button type="button" onClick={close}>取消</button>
              <button type="button" disabled={devices.length < 2} onClick={switchCamera}>切换摄像头</button>
              <button className="primary-button camera-shot" type="button" onClick={capture}>拍照</button>
            </>
          )}
          {status === 'captured' && (
            <>
              <button type="button" onClick={close}>取消</button>
              <button type="button" onClick={retake}>重拍</button>
              <button type="button" onClick={continueCapture}>继续拍照</button>
              <button className="primary-button" type="button" onClick={() => confirmUpload()}>确认上传</button>
            </>
          )}
          {(status === 'requesting' || status === 'uploading') && <button type="button" onClick={close}>取消</button>}
          {(status === 'fallback' || status === 'error') && (
            <>
              <button type="button" onClick={close}>取消</button>
              <button type="button" onClick={() => fileInputRef.current?.click()}>选择照片</button>
              {canUseCamera && <button className="primary-button" type="button" onClick={() => startCamera(deviceId)}>重新请求摄像头</button>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
