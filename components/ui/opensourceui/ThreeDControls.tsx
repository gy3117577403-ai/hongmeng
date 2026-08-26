'use client';

/*
 * Interaction patterns adapted for this product from OpenSourceUI components
 * (3D Button, 3D Icon Button, OTP Underline Input, Combobox Field Input,
 * File Upload Field Input, Hold To Delete Button, Film Strip).
 * OpenSourceUI is MIT licensed: https://opensourceui.in/
 */

import {
  ChevronDown,
  FileText,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  ButtonHTMLAttributes,
  ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

type ThreeDButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'orange' | 'neutral' | 'danger';
  compact?: boolean;
};

export function ThreeDButton({ className = '', tone = 'neutral', compact = false, ...props }: ThreeDButtonProps) {
  return <button
    {...props}
    className={`osui-3d-button tone-${tone}${compact ? ' compact' : ''} ${className}`.trim()}
  />;
}

type ThreeDIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  danger?: boolean;
};

export function ThreeDIconButton({ label, active = false, danger = false, className = '', ...props }: ThreeDIconButtonProps) {
  return <button
    {...props}
    type={props.type || 'button'}
    aria-label={label}
    title={props.title || label}
    className={`osui-3d-icon${active ? ' active' : ''}${danger ? ' danger' : ''} ${className}`.trim()}
  />;
}

export function MaterialCodePlate({ code }: { code?: string | null }) {
  const digits = (code?.match(/^MAT-(\d+)$/)?.[1] || '').padStart(6, '·').slice(-6).split('');
  return <div className="osui-code-plate" aria-label={code ? `固定物料编码 ${code}` : '物料编码将在保存后自动生成'}>
    <span>MAT</span><b>—</b>
    <div>{digits.map((digit, index) => <i className={digit === '·' ? 'pending' : ''} key={`${digit}-${index}`}>{digit}</i>)}</div>
  </div>;
}

export function ComboboxField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const filtered = useMemo(() => {
    const query = value.trim().toLocaleLowerCase('zh-CN');
    const unique = [...new Set(options.filter(Boolean))];
    return (query ? unique.filter(option => option.toLocaleLowerCase('zh-CN').includes(query)) : unique).slice(0, 8);
  }, [options, value]);

  function select(option: string) {
    onChange(option);
    setOpen(false);
    setHighlighted(0);
  }

  return <label className="osui-combobox-field">
    <span>{label}</span>
    <div>
      <Search size={15} />
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={event => { onChange(event.target.value); setOpen(true); setHighlighted(0); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setHighlighted(current => Math.min(current + 1, Math.max(0, filtered.length - 1)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted(current => Math.max(current - 1, 0));
          } else if (event.key === 'Enter' && open && filtered[highlighted]) {
            event.preventDefault();
            select(filtered[highlighted]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <ChevronDown size={15} />
    </div>
    {open && filtered.length > 0 && <div id={listboxId} className="osui-combobox-popover" role="listbox">
      {filtered.map((option, index) => <button
        type="button"
        role="option"
        aria-selected={option === value}
        className={index === highlighted ? 'highlighted' : ''}
        key={option}
        onMouseDown={event => event.preventDefault()}
        onClick={() => select(option)}
      ><Search size={13} />{option}</button>)}
    </div>}
  </label>;
}

export function FileUploadField({
  label,
  file,
  onChange,
  accept = '.pdf,image/jpeg,image/png,image/webp',
  hint = '支持 PDF、JPG、PNG、WEBP，文件将保存到对象存储',
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className="osui-file-field">
    <span>{label}</span>
    <button
      type="button"
      className={file ? 'has-file' : ''}
      onClick={() => inputRef.current?.click()}
      onDragOver={event => event.preventDefault()}
      onDrop={event => {
        event.preventDefault();
        onChange(event.dataTransfer.files?.[0] || null);
      }}
    >
      {file ? <><FileText size={20} /><span><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size / 1024))} KB · 点击可替换</small></span><i role="button" aria-label="移除待上传文件" onClick={event => { event.stopPropagation(); onChange(null); }}><X size={15} /></i></> : <><UploadCloud size={22} /><span><strong>拖入或选择供应商规格书</strong><small>{hint}</small></span></>}
    </button>
    <input ref={inputRef} type="file" accept={accept} onChange={event => onChange(event.target.files?.[0] || null)} />
  </div>;
}

export function HoldToDeleteButton({
  children,
  onConfirm,
  disabled = false,
}: {
  children: ReactNode;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const timer = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);

  function clear() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  }

  function start() {
    if (disabled) return;
    clear();
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, 900);
  }

  return <button
    type="button"
    disabled={disabled}
    className={`osui-hold-delete${holding ? ' holding' : ''}`}
    onPointerDown={start}
    onPointerUp={clear}
    onPointerCancel={clear}
    onPointerLeave={clear}
    onContextMenu={event => event.preventDefault()}
  ><span className="osui-hold-progress" /><Trash2 size={15} /><em>{children}</em><small>{holding ? '继续按住…' : '按住删除'}</small></button>;
}
