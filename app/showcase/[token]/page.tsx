import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CapabilityShowcaseView } from '@/components/capability-showcase/CapabilityShowcaseView';
import { resolveCapabilityShowcaseShare } from '@/lib/capability-showcase-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: '线束制造能力展示',
  description: '只读线束产品、工艺与设备能力展示页',
  robots: { index: false, follow: false, nocache: true },
};

export default async function CapabilityShowcaseSharePage({ params }: { params: { token: string } }) {
  const resolved = await resolveCapabilityShowcaseShare(params.token);
  if (!resolved) notFound();
  return (
    <CapabilityShowcaseView
      content={resolved.content}
      mediaMode="share"
      shareToken={params.token}
      publishedAt={resolved.publishedAt.toISOString()}
    />
  );
}
