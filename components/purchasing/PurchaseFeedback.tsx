"use client";
import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { CheckCircle2, X } from "lucide-react";
export function PurchaseConfirm({
  cancel,
  confirm,
}: {
  cancel: () => void;
  confirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="pc-overlay pc-confirm-overlay"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
        if (e.key === "Tab") {
          const buttons = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>("button") || [],
          );
          if (e.shiftKey && document.activeElement === buttons[0]) {
            e.preventDefault();
            buttons.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === buttons.at(-1)) {
            e.preventDefault();
            buttons[0]?.focus();
          }
        }
      }}
    >
      <div
        className="pc-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pc-confirm-title"
        aria-describedby="pc-confirm-message"
        ref={ref}
      >
        <h3 id="pc-confirm-title">保留未保存的输入？</h3>
        <p id="pc-confirm-message">
          此窗口还有未保存的内容。继续编辑可以保留输入，放弃后将关闭窗口。
        </p>
        <div className="pc-actions">
          <button className="pc-primary" onClick={cancel}>
            继续编辑
          </button>
          <button onClick={confirm}>放弃并关闭</button>
        </div>
      </div>
    </div>
  );
}
export function PurchaseToast({
  message,
  close,
}: {
  message: string;
  close: () => void;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!message || paused) return;
    const timer = setTimeout(close, 3200);
    return () => clearTimeout(timer);
  }, [message, paused, close]);
  if (!message) return null;
  return (
    <div
      className="pc-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      <CheckCircle2 size={21} />
      <span>{message}</span>
      <button onClick={close} aria-label="关闭提示">
        <X size={17} />
      </button>
    </div>
  );
}
function flatten(
  children: ReactNode,
): ReactElement<{ className?: string; children?: ReactNode }>[] {
  return Children.toArray(children).flatMap((c) =>
    !isValidElement<{ children?: ReactNode }>(c)
      ? []
      : c.type === Fragment
        ? flatten(c.props.children)
        : [c],
  );
}
export function PurchaseActions({
  children,
  condensed,
}: {
  children: ReactNode;
  condensed: boolean;
}) {
  const buttons = flatten(children),
    [expanded, setExpanded] = useState(false);
  const primary = buttons.find((b) => b.props.className === "pc-primary");
  const safe = buttons.filter(
    (b) =>
      b !== primary &&
      !/作废|撤回|退货|关闭未付|修订|补录/.test(String(b.props.children)),
  );
  const visible = condensed
    ? [primary, ...safe.slice(0, primary ? 2 : 3)].filter(
        (b): b is (typeof buttons)[number] => !!b,
      )
    : buttons;
  const more = buttons.filter((b) => !visible.includes(b));
  return (
    <div className="pc-actions" onClick={() => setExpanded(false)}>
      {visible.map((b, i) =>
        cloneElement(b, {
          key: b.key || i,
          className: b === primary ? "pc-primary" : "",
        }),
      )}
      {more.length > 0 && (
        <div className="pc-more">
          <button
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            更多 · {more.length}
          </button>
          {expanded && (
            <div className="pc-more-menu">
              {more.map((b, i) =>
                cloneElement(b, {
                  key: b.key || i,
                  className: /作废|撤回|关闭未付/.test(String(b.props.children))
                    ? "pc-danger-action"
                    : "",
                }),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
