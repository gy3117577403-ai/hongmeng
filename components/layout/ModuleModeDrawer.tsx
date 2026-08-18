'use client';

import {
  Check,
  ChevronDown,
  ChevronRight,
  Factory,
  FlaskConical,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export type BusinessMode = 'mass' | 'sample';

type ModeOption = {
  href: string;
  title: string;
  description: string;
  count?: number;
  countLabel?: string;
};

type ModuleModeDrawerProps = {
  id: string;
  open: boolean;
  moduleLabel: string;
  mode: BusinessMode;
  mass: ModeOption;
  sample: ModeOption;
  onClose: () => void;
};

type ModuleModeTriggerProps = {
  buttonRef?: RefObject<HTMLButtonElement>;
  open: boolean;
  mode: BusinessMode;
  onClick: () => void;
  controls: string;
  compact?: boolean;
};

function removeChooserParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('chooseMode')) return;
  url.searchParams.delete('chooseMode');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', next);
}

export function useModuleModeDrawer(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((restoreFocus = true): void => {
    setOpen(false);
    removeChooserParam();
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const toggle = useCallback((): void => {
    setOpen(value => {
      const next = !value;
      if (!next) removeChooserParam();
      return next;
    });
  }, []);

  return { open, setOpen, toggle, close, triggerRef };
}

export function ModuleModeTrigger({
  buttonRef,
  open,
  mode,
  onClick,
  controls,
  compact = false,
}: ModuleModeTriggerProps) {
  const label = mode === 'sample' ? '样品' : '量产';
  return <button
    ref={buttonRef}
    className={`hm-module-mode-trigger mode-${mode}${compact ? ' compact' : ''}`}
    type="button"
    aria-expanded={open}
    aria-controls={controls}
    aria-label={`当前${label}模式，${open ? '收起' : '展开'}业务模式选择`}
    onClick={onClick}
  >
    {mode === 'sample' ? <FlaskConical size={14} aria-hidden="true" /> : <Factory size={14} aria-hidden="true" />}
    <span>{label}</span>
    <ChevronDown className={open ? 'open' : ''} size={13} aria-hidden="true" />
  </button>;
}

export function ModuleModeDrawer({
  id,
  open,
  moduleLabel,
  mode,
  mass,
  sample,
  onClose,
}: ModuleModeDrawerProps) {
  const activeOptionRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => activeOptionRef.current?.focus());
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const options: Array<{ key: BusinessMode; icon: typeof Factory; value: ModeOption }> = [
    { key: 'mass', icon: Factory, value: mass },
    { key: 'sample', icon: FlaskConical, value: sample },
  ];

  return <section className="hm-module-mode-drawer" id={id} aria-label={`${moduleLabel}业务模式选择`}>
    <header>
      <div>
        <span>业务模式</span>
        <strong>选择{moduleLabel}类型</strong>
        <small>量产与样品共用模块入口，业务数据保持隔离</small>
      </div>
      <button type="button" aria-label="收起业务模式选择" onClick={() => onClose()}><X size={17} /></button>
    </header>
    <div className="hm-module-mode-options">
      {options.map(option => {
        const Icon = option.icon;
        const selected = option.key === mode;
        return <Link
          ref={selected ? activeOptionRef : undefined}
          className={`hm-module-mode-option mode-${option.key}${selected ? ' active' : ''}`}
          href={option.value.href}
          prefetch={false}
          aria-current={selected ? 'page' : undefined}
          key={option.key}
        >
          <span className="hm-module-mode-icon"><Icon size={22} aria-hidden="true" /></span>
          <span className="hm-module-mode-copy">
            <span><strong>{option.value.title}</strong>{selected && <em><Check size={12} />当前</em>}</span>
            <small>{option.value.description}</small>
          </span>
          {typeof option.value.count === 'number' && <span className="hm-module-mode-count"><b>{option.value.count}</b><small>{option.value.countLabel || '项'}</small></span>}
          <ChevronRight className="hm-module-mode-arrow" size={17} aria-hidden="true" />
        </Link>;
      })}
    </div>
  </section>;
}
