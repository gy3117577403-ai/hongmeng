import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: '现场扫码报工 · 杭连协同平台',
  description: '扫描工单二维码，选择工序并自动记录员工标准工时',
  manifest: '/field-report-manifest.webmanifest',
  appleWebApp: { capable: true, title: '现场报工', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#f97316',
};

export default function FieldReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
