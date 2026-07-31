import { NextRequest } from 'next/server';
import { publishSopVersion } from '@/lib/sop/publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return publishSopVersion(req, params.id);
}
