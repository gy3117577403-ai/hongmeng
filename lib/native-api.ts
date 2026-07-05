import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { verifyToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export class NativeUnauthorizedError extends Error {}

interface NativeDownloadTicketPayload {
  path: string;
  userId: string;
  exp: number;
}

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

function ticketSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET missing or too short');
  return secret;
}

function signDownloadPayload(payload: string): string {
  return crypto.createHmac('sha256', ticketSecret()).update(payload).digest('base64url');
}

export function createNativeDownloadTicket(path: string, userId: string, expiresInSeconds = 600): string {
  const payload: NativeDownloadTicketPayload = {
    path,
    userId,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signDownloadPayload(encoded)}`;
}

export function ticketedNativeDownloadPath(path: string, userId: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}ticket=${encodeURIComponent(createNativeDownloadTicket(path, userId))}`;
}

function verifyNativeDownloadTicket(req: NextRequest | Request): string | null {
  const url = new URL(req.url);
  const ticket = url.searchParams.get('ticket') || '';
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = signDownloadPayload(parts[0]);
  const actualBuffer = Buffer.from(parts[1]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as NativeDownloadTicketPayload;
    if (payload.path !== url.pathname) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.userId || null;
  } catch {
    return null;
  }
}

export async function requireNativeDownloadUser(req: NextRequest | Request) {
  try {
    return await requireNativeUser(req);
  } catch (error) {
    if (!(error instanceof NativeUnauthorizedError)) throw error;
  }
  const userId = verifyNativeDownloadTicket(req);
  if (!userId) throw new NativeUnauthorizedError();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, isActive: true },
  });
  if (!user?.isActive) throw new NativeUnauthorizedError();
  return { id: user.id, username: user.username, displayName: user.displayName };
}

export function isAllowedNativeDownloadPath(path: string): boolean {
  if (/^\/api\/native\/resource-files\/[^/]+\/(content|download)$/.test(path)) return true;
  if (/^\/api\/native\/work-orders\/[^/]+\/download-all$/.test(path)) return true;
  if (/^\/api\/native\/connector-parameter-files\/[^/]+\/download$/.test(path)) return true;
  if (path === '/api/native/connector-parameters/export.csv') return true;
  if (path === '/api/native/connector-parameters/template.csv') return true;
  return false;
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
}, userId?: string) {
  const contentPath = `/api/native/resource-files/${file.id}/content`;
  const downloadPath = `/api/native/resource-files/${file.id}/download`;
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
    contentUrl: userId ? ticketedNativeDownloadPath(contentPath, userId) : contentPath,
    downloadUrl: userId ? ticketedNativeDownloadPath(downloadPath, userId) : downloadPath,
  };
}
