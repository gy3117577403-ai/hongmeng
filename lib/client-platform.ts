'use client';

export type AndroidBridgeCapabilities = {
  fileChooser?: boolean;
  cameraCapture?: boolean;
  downloadManager?: boolean;
  clipboard?: boolean;
  speech?: boolean;
  userAgent?: string;
};

type AndroidBridge = {
  copyText?: (text: string) => void;
  getCapabilities?: () => string;
};

declare global {
  interface Window {
    AndroidBridge?: AndroidBridge;
    __HONGMENG_WEBVIEW__?: boolean;
    __HONGMENG_APK_CAPABILITIES__?: string;
  }
}

export function isAndroidWebView() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return !!window.__HONGMENG_WEBVIEW__ || ua.includes('HongmengWorkorderWebView') || ua.includes('; wv') || /\bwv\b/i.test(ua);
}

export function hasAndroidBridge() {
  return typeof window !== 'undefined' && !!window.AndroidBridge;
}

export function getAndroidCapabilities(): AndroidBridgeCapabilities | null {
  if (typeof window === 'undefined') return null;
  const raw = window.AndroidBridge?.getCapabilities?.() || window.__HONGMENG_APK_CAPABILITIES__;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AndroidBridgeCapabilities;
  } catch {
    return null;
  }
}

export async function writeClipboardText(text: string) {
  if (typeof window !== 'undefined' && window.AndroidBridge?.copyText) {
    window.AndroidBridge.copyText(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('copy failed');
}
