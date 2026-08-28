import { NextRequest } from 'next/server';
import { documentDisplaySettings } from '@/lib/document-orientation.server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(req: NextRequest, { params }: { params: { fileId: string } }) { return documentDisplaySettings(req, 'drawing', params.fileId); }
export const PATCH = GET;
