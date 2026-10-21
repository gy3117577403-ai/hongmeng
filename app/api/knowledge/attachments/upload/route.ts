import { NextRequest, NextResponse } from 'next/server';
import { requireUser, UnauthorizedError, unauthorized } from '@/lib/auth';
import { uploadKnowledgeAttachment } from '@/lib/knowledge-upload';
import { maxBytes } from '@/lib/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { return uploadKnowledgeAttachment(req); }
export async function GET() {
  try { await requireUser(); return NextResponse.json({ ok: true, maxBytes: maxBytes() }); }
  catch (error) { if (error instanceof UnauthorizedError) return unauthorized(); throw error; }
}
