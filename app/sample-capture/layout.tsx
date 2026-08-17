import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '样品数据采集 · 杭连协同平台',
  description: '扫码采集样品数据、过程照片与成品照片',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#f97316',
};

export default function SampleCaptureLayout({ children }: { children: React.ReactNode }) {
  return children;
}
