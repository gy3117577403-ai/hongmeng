'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import {
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  clampPreviewZoom,
  constrainPreviewPan,
  normalizePreviewRotation,
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
  initialFitMode?: Exclude<PreviewFitMode, 'manual'>;
  initialRotation?: number;
  scrollWheel?: boolean;
  controlledRotation?: number;
  memoryKey?: string;
};

type ViewMemory = { zoom: number; fitMode: PreviewFitMode; pan: PreviewPan; left: number; top: number };
const viewMemories = new Map<string, ViewMemory>();

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
  initialFitMode = 'fit-window',
  initialRotation = 0,
  scrollWheel = false,
  controlledRotation,
  memoryKey,
}: PreviewGestureOptions): PreviewGestureController {
  const normalizedInitialRotation = normalizePreviewRotation(controlledRotation ?? initialRotation);
  const [zoom, setZoom] = useState(1);
  const [committedZoom, setCommittedZoom] = useState(1);
  const [fitMode, setFitModeState] = useState<PreviewFitMode>(initialFitMode);
  const [rotation, setRotation] = useState(normalizedInitialRotation);
  const [pan, setPan] = useState<PreviewPan>({ panX: 0, panY: 0 });
  const [isGestureActive, setGestureActive] = useState(false);
  const [isDragging, setDragging] = useState(false);
  const [zoomHint, setZoomHint] = useState('');
  const zoomRef = useRef(zoom);
  const fitModeRef = useRef(fitMode);
  const panRef = useRef(pan);
  const rotationRef = useRef(rotation);
  const commitTimerRef = useRef<number | null>(null);
  const settleFrameRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const pointersRef = useRef<Map<number, ActivePointer>>(new Map());
  const pinchRef = useRef<PinchStart | null>(null);
  const dragRef = useRef<DragStart | null>(null);
  const lastTapRef = useRef<LastTap | null>(null);
  const twoFingerTapRef = useRef<TwoFingerTapCandidate | null>(null);
  const lastTwoFingerTapRef = useRef<LastTap | null>(null);
  const pinchOccurredRef = useRef(false);
  const resetRef = useRef<() => void>(() => undefined);
  const wheelDeltaRef = useRef(0);
  const wheelPointRef = useRef<PreviewPoint>({ x: 0, y: 0 });
  const wheelFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);

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

  const commitZoom = useCallback((value: number): void => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    setGestureActive(true);
    setCommittedZoom(value);
    if (settleFrameRef.current !== null) window.cancelAnimationFrame(settleFrameRef.current);
    settleFrameRef.current = window.requestAnimationFrame(() => {
      settleFrameRef.current = null;
      setGestureActive(false);
    });
  }, []);

  const commitLater = useCallback((value: number, delay = settleDelay): void => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      commitZoom(value);
    }, delay);
  }, [commitZoom, settleDelay]);

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

  const applyScrollZoom = useCallback((nextValue: number, clientPoint: PreviewPoint): void => {
    const node = stageRef.current;
    if (!node) return;
    const nextZoom = clampPreviewZoom(nextValue);
    const surface = node.querySelector<HTMLElement>('.viewer-scroll-surface');
    const surfaceRect = surface?.getBoundingClientRect();
    const focalRatioX = surfaceRect?.width
      ? Math.max(0, Math.min(1, (clientPoint.x - surfaceRect.left) / surfaceRect.width))
      : 0.5;
    const focalRatioY = surfaceRect?.height
      ? Math.max(0, Math.min(1, (clientPoint.y - surfaceRect.top) / surfaceRect.height))
      : 0.5;

    zoomRef.current = nextZoom;
    fitModeRef.current = 'manual';
    setFitModeState('manual');
    setZoom(nextZoom);
    setGestureActive(true);
    showHint(nextZoom === MIN_PREVIEW_ZOOM || nextZoom === MAX_PREVIEW_ZOOM ? `${Math.round(nextZoom * 100)}% · 已到缩放边界` : `${Math.round(nextZoom * 100)}%`);
    commitLater(nextZoom);

    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const nextSurfaceRect = surface?.getBoundingClientRect();
      if (!nextSurfaceRect) return;
      const nextFocalX = nextSurfaceRect.left + nextSurfaceRect.width * focalRatioX;
      const nextFocalY = nextSurfaceRect.top + nextSurfaceRect.height * focalRatioY;
      node.scrollLeft = Math.max(0, node.scrollLeft + nextFocalX - clientPoint.x);
      node.scrollTop = Math.max(0, node.scrollTop + nextFocalY - clientPoint.y);
    });
  }, [commitLater, showHint, stageRef]);

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
    commitZoom(nextZoom);
    setPan({ panX: 0, panY: 0 });
    stageRef.current?.scrollTo({ left: 0, top: 0 });
    showHint(mode === 'fit-height' ? '适应高度' : mode === 'fit-window' ? '适应整页' : mode === 'fit-width' ? '适应宽度' : '原始大小');
  }, [commitZoom, contentSize, showHint, stageRef, viewportSize]);

  const reset = useCallback((): void => {
    const nextRotation = normalizePreviewRotation(controlledRotation ?? initialRotation);
    rotationRef.current = nextRotation;
    setRotation(nextRotation);
    const nextZoom = previewFitZoom(initialFitMode, rotatedPreviewSize(contentSize, nextRotation), viewportSize);
    fitModeRef.current = initialFitMode;
    zoomRef.current = nextZoom;
    panRef.current = { panX: 0, panY: 0 };
    setFitModeState(initialFitMode);
    setZoom(nextZoom);
    commitZoom(nextZoom);
    setPan({ panX: 0, panY: 0 });
    stageRef.current?.scrollTo({ left: 0, top: 0 });
    showHint(initialFitMode === 'fit-height' ? '适应高度' : '适应整页');
  }, [commitZoom, contentSize, controlledRotation, initialFitMode, initialRotation, showHint, stageRef, viewportSize]);

  const recenter = useCallback((): void => {
    panRef.current = { panX: 0, panY: 0 };
    setPan({ panX: 0, panY: 0 });
    stageRef.current?.scrollTo({ left: 0, top: 0 });
  }, [stageRef]);

  const zoomBy = useCallback((factor: number): void => {
    const node = stageRef.current;
    if (scrollWheel && node) {
      const rect = node.getBoundingClientRect();
      applyScrollZoom(zoomRef.current * factor, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      return;
    }
    applyManualZoom(zoomRef.current * factor, { x: 0, y: 0 });
  }, [applyManualZoom, applyScrollZoom, scrollWheel, stageRef]);

  const rotateBy = useCallback((delta: number): void => {
    const nextRotation = normalizePreviewRotation(rotationRef.current + delta);
    rotationRef.current = nextRotation;
    setRotation(nextRotation);
    recenter();
  }, [recenter]);

  useEffect(() => {
    if (controlledRotation === undefined) return;
    const next = normalizePreviewRotation(controlledRotation);
    if (rotationRef.current === next) return;
    rotationRef.current = next;
    setRotation(next);
    recenter();
  }, [controlledRotation, recenter]);

  const toggleZoomAt = useCallback((clientX: number, clientY: number): void => {
    if (fitModeRef.current === 'fit-window' || fitModeRef.current === 'fit-height' || zoomRef.current <= fitWindowZoom * 1.2) {
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
      wheelDeltaRef.current += event.deltaY;
      wheelPointRef.current = { x: event.clientX, y: event.clientY };
      if (wheelFrameRef.current !== null) return;
      wheelFrameRef.current = window.requestAnimationFrame(() => {
        wheelFrameRef.current = null;
        const delta = wheelDeltaRef.current;
        wheelDeltaRef.current = 0;
        const factor = Math.max(0.72, Math.min(1.38, Math.exp(-delta * 0.0015)));
        if (scrollWheel) applyScrollZoom(zoomRef.current * factor, wheelPointRef.current);
        else applyManualZoom(zoomRef.current * factor, pointFromClient(wheelPointRef.current.x, wheelPointRef.current.y));
      });
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', wheel);
      if (wheelFrameRef.current !== null) window.cancelAnimationFrame(wheelFrameRef.current);
      wheelFrameRef.current = null;
      wheelDeltaRef.current = 0;
    };
  }, [applyManualZoom, applyScrollZoom, pointFromClient, scrollWheel, stageRef]);

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

  const restoredMemory = useRef('');
  useEffect(() => {
    if (!memoryKey || !contentSize.width || !viewportSize.width || restoredMemory.current === memoryKey) return;
    restoredMemory.current = memoryKey;
    const memory = viewMemories.get(memoryKey);
    if (!memory) return;
    fitModeRef.current = memory.fitMode;
    setFitModeState(memory.fitMode);
    if (memory.fitMode === 'manual') {
      zoomRef.current = memory.zoom; setZoom(memory.zoom); commitZoom(memory.zoom);
      panRef.current = memory.pan; setPan(memory.pan);
      const node = stageRef.current;
      window.requestAnimationFrame(() => node?.scrollTo({ left: memory.left, top: memory.top }));
    } else applyFitMode(memory.fitMode);
  }, [applyFitMode, commitZoom, contentSize.width, memoryKey, stageRef, viewportSize.width]);

  useEffect(() => {
    if (!memoryKey) return;
    const node = stageRef.current;
    const save = () => {
      if (restoredMemory.current !== memoryKey) return;
      viewMemories.set(memoryKey, { zoom: zoomRef.current, fitMode: fitModeRef.current, pan: panRef.current, left: node?.scrollLeft || 0, top: node?.scrollTop || 0 });
      if (viewMemories.size > 300) viewMemories.delete(viewMemories.keys().next().value as string);
    };
    node?.addEventListener('scroll', save);
    return () => { save(); node?.removeEventListener('scroll', save); };
  }, [memoryKey, stageRef]);

  useEffect(() => () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current);
    if (settleFrameRef.current !== null) window.cancelAnimationFrame(settleFrameRef.current);
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
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
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
      commitZoom(zoomRef.current);
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
