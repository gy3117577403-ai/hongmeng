'use client';

import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';

function lockBodyScroll(): void {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyLockCount += 1;
}

function unlockBodyScroll(): void {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
}

function focusableElements(layer: HTMLElement): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => (
    !element.hasAttribute('hidden')
    && element.getAttribute('aria-hidden') !== 'true'
    && element.getClientRects().length > 0
  ));
}

type ModalLayerOptions = {
  open: boolean;
  layerRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  backgroundRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  lockScroll?: boolean;
  interactionEnabled?: boolean;
};

export function useModalLayer({
  open,
  layerRef,
  triggerRef,
  initialFocusRef,
  backgroundRef,
  onClose,
  lockScroll = true,
  interactionEnabled = true,
}: ModalLayerOptions): void {
  const closeRef = useRef(onClose);
  const openRef = useRef(open);
  closeRef.current = onClose;
  openRef.current = open;

  useEffect(() => {
    if (!open) return undefined;
    const layer = layerRef.current;
    if (!layer) return undefined;
    const activeLayer: HTMLElement = layer;
    const returnTarget = triggerRef?.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const background = backgroundRef?.current;
    if (background) background.inert = true;
    if (lockScroll) lockBodyScroll();

    const focusInitial = (): void => {
      const target = initialFocusRef?.current || focusableElements(activeLayer)[0] || activeLayer;
      target.focus();
    };
    const frame = interactionEnabled ? window.requestAnimationFrame(focusInitial) : 0;

    function onKeyDown(event: KeyboardEvent): void {
      if (!interactionEnabled) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusableElements(activeLayer);
      if (!elements.length) {
        event.preventDefault();
        activeLayer.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeLayer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onFocusIn(event: FocusEvent): void {
      if (!interactionEnabled) return;
      if (activeLayer.contains(event.target as Node)) return;
      focusInitial();
    }

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      if (background) background.inert = false;
      if (lockScroll) unlockBodyScroll();
      if (!openRef.current) window.requestAnimationFrame(() => returnTarget?.focus());
    };
  }, [backgroundRef, initialFocusRef, interactionEnabled, layerRef, lockScroll, open, triggerRef]);
}

export function useHiddenLayerInert(open: boolean, layerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.inert = !open;
  }, [layerRef, open]);
}
