import { NextRequest } from 'next/server';
import { documentDisplaySettings } from '@/lib/document-orientation.server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(req: NextRequest, { params }: { params: { id: string } }) { return documentDisplaySettings(req, 'resource', params.id); }
export const PATCH = GET;
