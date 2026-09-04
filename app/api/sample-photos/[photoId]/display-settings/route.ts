import { NextRequest } from 'next/server';
import { documentDisplaySettings } from '@/lib/document-orientation.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { photoId: string } }) {
  return documentDisplaySettings(request, 'sample', params.photoId);
}

export async function PATCH(request: NextRequest, { params }: { params: { photoId: string } }) {
  return documentDisplaySettings(request, 'sample', params.photoId);
}
