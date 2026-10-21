import { NextRequest } from 'next/server';
import { uploadKnowledgeAttachment } from '@/lib/knowledge-upload';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return uploadKnowledgeAttachment(req, params.id);
}
