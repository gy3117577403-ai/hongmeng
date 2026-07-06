'use client';

import { useEffect, useRef, useState } from 'react';
import { hasAndroidBridge, isAndroidWebView } from '@/lib/client-platform';

type SpeechAlternativeLike = { transcript: string };
type SpeechResultLike = {
  isFinal: boolean;
  [index: number]: SpeechAlternativeLike | undefined;
};
type SpeechResultListLike = {
  length: number;
  [index: number]: SpeechResultLike | undefined;
};
type SpeechResultEventLike = { resultIndex: number; results: SpeechResultListLike };
type SpeechErrorEventLike = { error?: string; message?: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

type VoiceStatus = 'idle' | 'listening' | 'processing' | 'done' | 'error';

type VoiceInputButtonProps = {
  value: string;
  onChange: (value: string) => void;
  mode?: 'append' | 'replace';
  lang?: string;
  autoFocusPanel?: boolean;
  onApplied?: () => void;
  className?: string;
  label?: string;
};

function errorText(error?: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '麦克风权限被拒绝。';
  if (error === 'no-speech') return '未检测到语音。';
  if (error === 'audio-capture') return '未检测到可用麦克风。';
  if (error === 'network') return '网络异常，语音识别暂不可用。';
  if (error === 'language-not-supported' || error === 'language-not-allowed') return '当前语言不可用。';
  if (error === 'aborted') return '语音输入已取消。';
  return '识别服务不可用，请手动输入。';
}

function mergeText(base: string, text: string, mode: 'append' | 'replace') {
  const next = text.trim();
  if (!next) return base;
  if (mode === 'replace') return next;
  if (!base.trim()) return next;
  const spacer = /[\s，。；、,.!?！？]$/.test(base) ? '' : ' ';
  return `${base}${spacer}${next}`;
}

function statusText(status: VoiceStatus) {
  if (status === 'listening') return '正在听...';
  if (status === 'processing') return '正在识别...';
  if (status === 'done') return '已完成';
  if (status === 'error') return '识别失败';
  return '准备语音输入';
}

export function VoiceInputButton({
  value,
  onChange,
  mode = 'append',
  lang = 'zh-CN',
  onApplied,
  className = '',
  label = '语音输入',
}: VoiceInputButtonProps) {
  const instanceIdRef = useRef(`voice-${Math.random().toString(36).slice(2)}`);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseValueRef = useRef('');
  const finalTextRef = useRef('');
  const interimRef = useRef('');
  const errorRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [panelOpen, setPanelOpen] = useState(false);
  const [interim, setInterim] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState('');
  const [apkWebView, setApkWebView] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
    setApkWebView(isAndroidWebView() || hasAndroidBridge());
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      recognitionRef.current?.abort();
    };
  }, []);

  function clearTimer() {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  function armTimeout() {
    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      errorRef.current = true;
      setError('识别超时。');
      setStatus('error');
      recognitionRef.current?.stop();
    }, 16_000);
  }

  function apply(text = finalText || interim) {
    onChange(mergeText(baseValueRef.current || value, text, mode));
    setStatus(text.trim() ? 'done' : status);
    onApplied?.();
  }

  function resetText() {
    finalTextRef.current = '';
    interimRef.current = '';
    setFinalText('');
    setInterim('');
    setError('');
  }

  useEffect(() => {
    const closeOthers = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id === instanceIdRef.current) return;
      clearTimer();
      recognitionRef.current?.abort();
      setPanelOpen(false);
      setStatus('idle');
      resetText();
    };
    window.addEventListener('hongmeng:voice-open', closeOthers);
    return () => window.removeEventListener('hongmeng:voice-open', closeOthers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    clearTimer();
    recognitionRef.current?.stop();
    setStatus(finalTextRef.current || interimRef.current ? 'done' : 'idle');
  }

  function cancel() {
    clearTimer();
    recognitionRef.current?.abort();
    setPanelOpen(false);
    setStatus('idle');
    resetText();
  }

  function start() {
    window.dispatchEvent(new CustomEvent('hongmeng:voice-open', { detail: instanceIdRef.current }));
    if (!supported) {
      setPanelOpen(true);
      setError(apkWebView ? '当前 APK 暂不支持语音输入，请使用键盘输入。' : '当前浏览器不支持语音输入，请使用键盘输入。');
      setStatus('error');
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    clearTimer();
    recognitionRef.current?.abort();
    baseValueRef.current = value;
    finalTextRef.current = '';
    interimRef.current = '';
    errorRef.current = false;
    setFinalText('');
    setInterim('');
    setError('');
    setPanelOpen(true);
    setStatus('listening');
    const recognition = new Ctor();
    recognitionRef.current = recognition;
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setStatus('listening');
      armTimeout();
    };
    recognition.onspeechstart = () => {
      setStatus('processing');
      armTimeout();
    };
    recognition.onresult = event => {
      armTimeout();
      let interimText = '';
      let finalChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript || '';
        if (!text) continue;
        if (result?.isFinal) finalChunk += text;
        else interimText += text;
      }
      if (finalChunk) {
        finalTextRef.current = `${finalTextRef.current}${finalChunk}`;
        setFinalText(finalTextRef.current);
        onChange(mergeText(baseValueRef.current, finalTextRef.current, mode));
        onApplied?.();
      }
      interimRef.current = interimText;
      setInterim(interimText);
      setStatus(interimText ? 'processing' : 'listening');
    };
    recognition.onerror = event => {
      clearTimer();
      errorRef.current = true;
      setError(errorText(event.error));
      setStatus('error');
    };
    recognition.onend = () => {
      clearTimer();
      if (errorRef.current) return;
      if (!finalTextRef.current && !interimRef.current) {
        setError('未检测到语音。');
        setStatus('error');
        return;
      }
      if (interimRef.current && !finalTextRef.current) apply(interimRef.current);
      setStatus('done');
      onApplied?.();
    };
    try {
      recognition.start();
    } catch {
      setError('语音识别启动失败，请重试。');
      setStatus('error');
    }
  }

  const disabled = supported === false;
  const active = status === 'listening' || status === 'processing';
  const panelText = [finalText, interim].filter(Boolean).join(interim ? ' ' : '');
  const unsupportedTitle = apkWebView ? '当前 APK 暂不支持语音输入，请使用键盘输入' : '当前浏览器不支持语音输入，请使用键盘输入';

  return (
    <>
      <button
        className={`voice-button ${active ? 'active' : ''} ${disabled ? 'disabled' : ''} ${className}`}
        type="button"
        title={disabled ? unsupportedTitle : label}
        aria-label={label}
        onClick={active ? stop : start}
      >
        <span>{disabled ? '⌨' : active ? '●' : '🎙'}</span>
      </button>
      {panelOpen && (
        <section className="voice-input-panel" role="status" aria-live="polite">
          <div className="voice-panel-head">
            <strong>{statusText(status)}</strong>
            <button type="button" onClick={cancel}>×</button>
          </div>
          <div className={status === 'error' ? 'voice-text error' : 'voice-text'}>
            {error || panelText || '点击麦克风后开始说话，识别内容会先写入当前输入框。'}
          </div>
          <div className="voice-panel-actions">
            <button type="button" onClick={stop} disabled={!active}>停止</button>
            <button type="button" onClick={resetText}>清空</button>
            <button className="primary-button" type="button" onClick={() => apply()} disabled={!panelText}>应用到输入框</button>
            <button type="button" onClick={cancel}>取消</button>
          </div>
        </section>
      )}
    </>
  );
}
