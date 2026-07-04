import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export class NativeUnauthorizedError extends Error {}

export function nativeOk(data: unknown) {
  return NextResponse.json({ ok: true, data });
}

export function nativeError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export function nativeUnauthorized() {
  return nativeError('未登录或登录已过期', 401);
}

export function bearerToken(req: NextRequest | Request) {
  const auth = req.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

export async function requireNativeUser(req: NextRequest | Request) {
  const session = verifyToken(bearerToken(req));
  if (!session) throw new NativeUnauthorizedError();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, username: true, displayName: true, isActive: true },
  });
  if (!user?.isActive) throw new NativeUnauthorizedError();
  return { id: user.id, username: user.username, displayName: user.displayName };
}

export function nativeFileDto(file: {
  id: string;
  workOrderId: string;
  categoryId: string;
  originalName: string;
  displayName: string | null;
  remark: string | null;
  mimeType: string;
  fileType: string;
  fileSize: number;
  version: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  uploadedBy?: { displayName: string | null; username?: string } | null;
  category?: { name: string; code: string } | null;
}) {
  return {
    id: file.id,
    workOrderId: file.workOrderId,
    categoryId: file.categoryId,
    categoryName: file.category?.name || null,
    categoryCode: file.category?.code || null,
    originalName: file.originalName,
    displayName: file.displayName,
    remark: file.remark,
    mimeType: file.mimeType,
    fileType: file.fileType,
    fileSize: file.fileSize,
    version: file.version || 'V1.0',
    status: file.status,
    uploadedBy: file.uploadedBy?.displayName || file.uploadedBy?.username || null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    contentUrl: `/api/native/resource-files/${file.id}/content`,
    downloadUrl: `/api/native/resource-files/${file.id}/download`,
  };
}
