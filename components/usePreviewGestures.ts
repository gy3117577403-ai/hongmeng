'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import {
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  clampPreviewZoom,
  constrainPreviewPan,
  previewCanPan,
  previewDistance,
  previewFitZoom,
  previewMidpoint,
  previewPanForFocalZoom,
  rotatedPreviewSize,
} from '@/lib/preview-gestures';
import type { PreviewFitMode, PreviewPan, PreviewPoint, PreviewSize } from '@/lib/preview-gestures';

type ActivePointer = PreviewPoint & {
  startX: number;
  startY: number;
  pointerType: string;
  moved: boolean;
};

type PinchStart = {
  distance: number;
  midpoint: PreviewPoint;
  zoom: number;
  panX: number;
  panY: number;
};

type DragStart = {
  pointerId: number;
  x: number;
  y: number;
  panX: number;
  panY: number;
};

type LastTap = {
  at: number;
  x: number;
  y: number;
};

type TwoFingerTapCandidate = {
  startedAt: number;
  midpoint: PreviewPoint;
  moved: boolean;
};

type PreviewGestureOptions = {
  stageRef: RefObject<HTMLDivElement>;
  contentSize: PreviewSize;
  viewportSize: PreviewSize;
  resetKey: string;
  settleDelay?: number;
};

export type PreviewGestureController = {
  zoom: number;
  committedZoom: number;
  fitMode: PreviewFitMode;
  rotation: number;
  panX: number;
  panY: number;
  isGestureActive: boolean;
  isDragging: boolean;
  zoomHint: string;
  rotatedSize: PreviewSize;
  fitWindowZoom: number;
  setFitMode: (mode: Exclude<PreviewFitMode, 'manual'>) => void;
  zoomBy: (factor: number) => void;
  rotateBy: (delta: number) => void;
  reset: () => void;
  recenter: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export function usePreviewGestures({
  stageRef,
  contentSize,
  viewportSize,
  resetKey,
  settleDelay = 160,
}: PreviewGestureOptions): PreviewGestureController {
  const [zoom, setZoom] = useState(1);
  const [committedZoom, setCommittedZoom] = useState(1);
  const [fitMode, setFitModeState] = useState<PreviewFitMode>('fit-window');
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState<PreviewPan>({ panX: 0, panY: 0 });
  const [isGestureActive, setGestureActive] = useState(false);
  const [isDragging, setDragging] = useState(false);
  const [zoomHint, setZoomHint] = useState('');
  const zoomRef = useRef(zoom);
  const fitModeRef = useRef(fitMode);
  const panRef = useRef(pan);
  const rotationRef = useRef(rotation);
  const commitTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const pointersRef = useRef<Map<number, ActivePointer>>(new Map());
  const pinchRef = useRef<PinchStart | null>(null);
  const dragRef = useRef<DragStart | null>(null);
  const lastTapRef = useRef<LastTap | null>(null);
  const twoFingerTapRef = useRef<TwoFingerTapCandidate | null>(null);
  const lastTwoFingerTapRef = useRef<LastTap | null>(null);
  const pinchOccurredRef = useRef(false);
  const resetRef = useRef<() => void>(() => undefined);

  const rotatedSize = useMemo(() => rotatedPreviewSize(contentSize, rotation), [contentSize, rotation]);
  const fitWindowZoom = useMemo(() => previewFitZoom('fit-window', rotatedSize, viewportSize), [rotatedSize, viewportSize]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { fitModeRef.current = fitMode; }, [fitMode]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { rotationRef.current = rotation; }, [rotation]);

  const showHint = useCallback((value: string): void => {
    setZoomHint(value);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setZoomHint(''), 800);
  }, []);

  const commitLater = useCallback((value: number, delay = settleDelay): void => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      setCommittedZoom(value);
      setGestureActive(false);
    }, delay);
  }, [settleDelay]);

  const updatePan = useCallback((next: PreviewPan, nextZoom = zoomRef.current): void => {
    const constrained = constrainPreviewPan(next, rotatedPreviewSize(contentSize, rotationRef.current), viewportSize, nextZoom);
    panRef.current = constrained;
    setPan(constrained);
  }, [contentSize, viewportSize]);

  const applyManualZoom = useCallback((nextValue: number, focalPoint: PreviewPoint, immediate = false): void => {
    const nextZoom = clampPreviewZoom(nextValue);
    const nextPan = previewPanForFocalZoom(panRef.current, focalPoint, zoomRef.current, nextZoom);
    zoomRef.current = nextZoom;
    fitModeRef.current = 'manual';
    setFitModeState('manual');
    setZoom(nextZoom);
    updatePan(nextPan, nextZoom);
    setGestureActive(true);
    showHint(nextZoom === MIN_PREVIEW_ZOOM || nextZoom === MAX_PREVIEW_ZOOM ? `${Math.round(nextZoom * 100)}% · 已到缩放边界` : `${Math.round(nextZoom * 100)}%`);
    commitLater(nextZoom, immediate ? 0 : settleDelay);
  }, [commitLater, settleDelay, showHint, updatePan]);

  const pointFromClient = useCallback((clientX: number, clientY: number): PreviewPoint => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  }, [stageRef]);

  const applyFitMode = useCallback((mode: Exclude<PreviewFitMode, 'manual'>): void => {
    const nextZoom = previewFitZoom(mode, rotatedPreviewSize(contentSize, rotationRef.current), viewportSize);
    fitModeRef.current = mode;
    zoomRef.current = nextZoom;
    panRef.current = { panX: 0, panY: 0 };
    setFitModeState(mode);
    setZoom(nextZoom);
    setCommittedZoom(nextZoom);
    setPan({ panX: 0, panY: 0 });
    setGestureActive(false);
    showHint(mode === 'fit-window' ? '适应窗口' : mode === 'fit-width' ? '适应宽度' : '原始大小');
  }, [contentSize, showHint, viewportSize]);

  const reset = useCallback((): void => {
    rotationRef.current = 0;
    setRotation(0);
    const nextZoom = previewFitZoom('fit-window', contentSize, viewportSize);
    fitModeRef.current = 'fit-window';
    zoomRef.current = nextZoom;
    panRef.current = { panX: 0, panY: 0 };
    setFitModeState('fit-window');
    setZoom(nextZoom);
    setCommittedZoom(nextZoom);
    setPan({ panX: 0, panY: 0 });
    setGestureActive(false);
    showHint('适应窗口');
  }, [contentSize, showHint, viewportSize]);

  const recenter = useCallback((): void => {
    panRef.current = { panX: 0, panY: 0 };
    setPan({ panX: 0, panY: 0 });
  }, []);

  const zoomBy = useCallback((factor: number): void => {
    applyManualZoom(zoomRef.current * factor, { x: 0, y: 0 });
  }, [applyManualZoom]);

  const rotateBy = useCallback((delta: number): void => {
    const nextRotation = (rotationRef.current + delta + 360) % 360;
    rotationRef.current = nextRotation;
    setRotation(nextRotation);
    recenter();
  }, [recenter]);

  const toggleZoomAt = useCallback((clientX: number, clientY: number): void => {
    if (fitModeRef.current === 'fit-window' || zoomRef.current <= fitWindowZoom * 1.2) {
      applyManualZoom(Math.max(MIN_PREVIEW_ZOOM, fitWindowZoom * 2), pointFromClient(clientX, clientY));
    } else {
      applyFitMode('fit-window');
    }
  }, [applyFitMode, applyManualZoom, fitWindowZoom, pointFromClient]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      const factor = Math.max(0.88, Math.min(1.12, Math.exp(-event.deltaY * 0.0015)));
      applyManualZoom(zoomRef.current * factor, pointFromClient(event.clientX, event.clientY));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [applyManualZoom, pointFromClient, stageRef]);

  useEffect(() => {
    if (contentSize.width <= 0 || contentSize.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) return;
    if (fitModeRef.current !== 'manual') applyFitMode(fitModeRef.current);
    else updatePan(panRef.current, zoomRef.current);
  }, [applyFitMode, contentSize, rotation, updatePan, viewportSize]);

  useEffect(() => {
    resetRef.current = reset;
  }, [reset]);

  useEffect(() => {
    resetRef.current();
  }, [resetKey]);

  useEffect(() => () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic QA events and older WebViews may not expose an active pointer capture.
    }
    const point: ActivePointer = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pointerType: event.pointerType, moved: false };
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 1) {
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: panRef.current.panX, panY: panRef.current.panY };
      setDragging(previewCanPan(rotatedSize, viewportSize, zoomRef.current));
    } else if (pointersRef.current.size === 2) {
      const values = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: Math.max(1, previewDistance(values[0], values[1])),
        midpoint: previewMidpoint(values[0], values[1]),
        zoom: zoomRef.current,
        panX: panRef.current.panX,
        panY: panRef.current.panY,
      };
      pinchOccurredRef.current = true;
      twoFingerTapRef.current = {
        startedAt: Date.now(),
        midpoint: previewMidpoint(values[0], values[1]),
        moved: false,
      };
      dragRef.current = null;
      setDragging(false);
      setGestureActive(true);
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const current = pointersRef.current.get(event.pointerId);
    if (!current) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 5;
    pointersRef.current.set(event.pointerId, { ...current, x: event.clientX, y: event.clientY, moved });
    if (pointersRef.current.size >= 2) {
      event.preventDefault();
      const values = Array.from(pointersRef.current.values()).slice(0, 2);
      const start = pinchRef.current;
      if (!start) return;
      const midpoint = previewMidpoint(values[0], values[1]);
      const nextZoom = clampPreviewZoom(start.zoom * (previewDistance(values[0], values[1]) / start.distance));
      if (twoFingerTapRef.current && (
        values.some(value => value.moved)
        || Math.abs(previewDistance(values[0], values[1]) - start.distance) > 8
        || Math.hypot(midpoint.x - start.midpoint.x, midpoint.y - start.midpoint.y) > 8
      )) twoFingerTapRef.current.moved = true;
      const ratio = nextZoom / Math.max(0.001, start.zoom);
      const startLocal = pointFromClient(start.midpoint.x, start.midpoint.y);
      const nextLocal = pointFromClient(midpoint.x, midpoint.y);
      const nextPan = {
        panX: nextLocal.x - (startLocal.x - start.panX) * ratio,
        panY: nextLocal.y - (startLocal.y - start.panY) * ratio,
      };
      zoomRef.current = nextZoom;
      fitModeRef.current = 'manual';
      setFitModeState('manual');
      setZoom(nextZoom);
      updatePan(nextPan, nextZoom);
      setGestureActive(true);
      showHint(`${Math.round(nextZoom * 100)}%`);
      commitLater(nextZoom);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !previewCanPan(rotatedSize, viewportSize, zoomRef.current)) return;
    event.preventDefault();
    setDragging(true);
    setGestureActive(true);
    updatePan({ panX: drag.panX + event.clientX - drag.x, panY: drag.panY + event.clientY - drag.y });
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const pointer = pointersRef.current.get(event.pointerId);
    const wasSingle = pointersRef.current.size === 1;
    pointersRef.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.entries())[0];
      dragRef.current = { pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y, panX: panRef.current.panX, panY: panRef.current.panY };
    } else if (pointersRef.current.size === 0) {
      dragRef.current = null;
      setDragging(false);
      setGestureActive(false);
      setCommittedZoom(zoomRef.current);
      const twoFingerTap = twoFingerTapRef.current;
      if (twoFingerTap && !twoFingerTap.moved && Date.now() - twoFingerTap.startedAt <= 300) {
        const last = lastTwoFingerTapRef.current;
        if (last && Date.now() - last.at <= 300 && Math.hypot(twoFingerTap.midpoint.x - last.x, twoFingerTap.midpoint.y - last.y) <= 24) {
          applyFitMode('fit-window');
          lastTwoFingerTapRef.current = null;
        } else {
          lastTwoFingerTapRef.current = { at: Date.now(), x: twoFingerTap.midpoint.x, y: twoFingerTap.midpoint.y };
        }
      }
      twoFingerTapRef.current = null;
    }
    if (pointer?.pointerType === 'touch' && wasSingle && !pointer.moved && !pinchOccurredRef.current) {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && now - last.at <= 300 && Math.hypot(pointer.x - last.x, pointer.y - last.y) <= 24) {
        toggleZoomAt(pointer.x, pointer.y);
        lastTapRef.current = null;
      } else {
        lastTapRef.current = { at: now, x: pointer.x, y: pointer.y };
      }
    }
    if (pointersRef.current.size === 0) pinchOccurredRef.current = false;
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    toggleZoomAt(event.clientX, event.clientY);
  }

  return {
    zoom,
    committedZoom,
    fitMode,
    rotation,
    panX: pan.panX,
    panY: pan.panY,
    isGestureActive,
    isDragging,
    zoomHint,
    rotatedSize,
    fitWindowZoom,
    setFitMode: applyFitMode,
    zoomBy,
    rotateBy,
    reset,
    recenter,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onDoubleClick,
  };
}
