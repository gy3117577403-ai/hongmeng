import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { maxBytes } from '@/lib/validation';
import { displayWorkOrderCode } from '@/lib/work-orders';
import { resolveLocalImportHelperBinding } from '@/lib/local-import-pairing-state';

export const LOCAL_IMPORT_TASK_TTL_SECONDS = 10 * 60;
export const LOCAL_IMPORT_MAX_FILES = 20;
export const LOCAL_IMPORT_LOOPBACK_URL = 'http://127.0.0.1:17651';
export const LOCAL_IMPORT_ALLOWED_STATES = new Set(['waiting', 'connected', 'uploading', 'paused', 'completed']);

export type LocalImportTicketPayload = {
  v: 1;
  kind: 'local_import';
  taskId: string;
  workOrderId: string;
  categoryId: string;
  userId: string;
  handshakeId: string;
  iat: number;
  exp: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  helperInstanceId?: string;
};

export type LocalImportTaskDetail = {
  workOrderId: string;
  categoryId: string;
  handshakeId: string;
  expiresAt: string;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  state: string;
  helperConnectedAt?: string;
  completedAt?: string;
  pairingCodeHash?: string;
  pairingUsedAt?: string;
  helperInstanceId?: string;
};

export type LocalImportTaskRecord = {
  id: string;
  userId: string;
  createdAt: Date;
  detail: LocalImportTaskDetail;
};

export type LocalImportTaskSummary = {
  state: string;
  successCount: number;
  duplicateCount: number;
  failedCount: number;
  processedCount: number;
  uploadedBytes: number;
  latestFileId: string | null;
};

export class LocalImportError extends Error {
  constructor(message: string, public status = 400, public code = 'LOCAL_IMPORT_ERROR') {
    super(message);
  }
}

function signingSecret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error('SESSION_SECRET missing or too short');
  return crypto.createHmac('sha256', value).update('hongmeng-local-import-v1').digest();
}

function sign(payload: string) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

export function createLocalImportPairingCode() {
  const code = crypto.randomInt(100_000, 1_000_000).toString();
  return { code, hash: hashLocalImportPairingCode(code) };
}

export function hashLocalImportPairingCode(code: string) {
  return crypto.createHmac('sha256', signingSecret()).update(`pairing-code:${code}`).digest('hex');
}

export function localImportLimits() {
  const maxFileBytes = maxBytes();
  const configuredTotalMb = Number(process.env.LOCAL_IMPORT_MAX_TOTAL_MB || 500);
  const maxTotalBytes = Math.max(maxFileBytes, Math.min(2048 * 1024 * 1024, (Number.isFinite(configuredTotalMb) ? configuredTotalMb : 500) * 1024 * 1024));
  return { maxFiles: LOCAL_IMPORT_MAX_FILES, maxFileBytes, maxTotalBytes };
}

export function createLocalImportTicket(input: Omit<LocalImportTicketPayload, 'v' | 'kind' | 'iat' | 'exp'> & { expiresAt: Date }) {
  const now = Math.floor(Date.now() / 1000);
  const payload: LocalImportTicketPayload = {
    v: 1,
    kind: 'local_import',
    taskId: input.taskId,
    workOrderId: input.workOrderId,
    categoryId: input.categoryId,
    userId: input.userId,
    handshakeId: input.handshakeId,
    iat: now,
    exp: Math.floor(input.expiresAt.getTime() / 1000),
    maxFiles: input.maxFiles,
    maxFileBytes: input.maxFileBytes,
    maxTotalBytes: input.maxTotalBytes,
    helperInstanceId: input.helperInstanceId,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

function isTicketPayload(value: unknown): value is LocalImportTicketPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.v === 1
    && item.kind === 'local_import'
    && typeof item.taskId === 'string'
    && typeof item.workOrderId === 'string'
    && typeof item.categoryId === 'string'
    && typeof item.userId === 'string'
    && typeof item.handshakeId === 'string'
    && typeof item.iat === 'number'
    && typeof item.exp === 'number'
    && typeof item.maxFiles === 'number'
    && typeof item.maxFileBytes === 'number'
    && typeof item.maxTotalBytes === 'number'
    && (item.helperInstanceId === undefined || typeof item.helperInstanceId === 'string');
}

export function verifyLocalImportTicket(ticket?: string | null) {
  if (!ticket) throw new LocalImportError('缺少导入任务票据', 401, 'MISSING_TICKET');
  const [encoded, signature] = ticket.split('.');
  if (!encoded || !signature) throw new LocalImportError('导入任务票据无效', 401, 'INVALID_TICKET');
  const expected = sign(encoded);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    throw new LocalImportError('导入任务票据无效', 401, 'INVALID_TICKET');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new LocalImportError('导入任务票据无效', 401, 'INVALID_TICKET');
  }
  if (!isTicketPayload(parsed)) throw new LocalImportError('导入任务票据无效', 401, 'INVALID_TICKET');
  if (parsed.exp <= Math.floor(Date.now() / 1000)) throw new LocalImportError('导入任务已过期', 410, 'TASK_EXPIRED');
  return parsed;
}

function jsonObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function requiredString(value: Prisma.JsonValue | undefined, field: string) {
  if (typeof value !== 'string' || !value) throw new LocalImportError(`导入任务缺少 ${field}`, 500, 'TASK_DATA_INVALID');
  return value;
}

function requiredNumber(value: Prisma.JsonValue | undefined, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new LocalImportError(`导入任务缺少 ${field}`, 500, 'TASK_DATA_INVALID');
  return value;
}

function parseTaskDetail(value: Prisma.JsonValue | null): LocalImportTaskDetail {
  const item = jsonObject(value);
  return {
    workOrderId: requiredString(item.workOrderId, 'workOrderId'),
    categoryId: requiredString(item.categoryId, 'categoryId'),
    handshakeId: requiredString(item.handshakeId, 'handshakeId'),
    expiresAt: requiredString(item.expiresAt, 'expiresAt'),
    maxFiles: requiredNumber(item.maxFiles, 'maxFiles'),
    maxFileBytes: requiredNumber(item.maxFileBytes, 'maxFileBytes'),
    maxTotalBytes: requiredNumber(item.maxTotalBytes, 'maxTotalBytes'),
    state: typeof item.state === 'string' ? item.state : 'waiting',
    helperConnectedAt: typeof item.helperConnectedAt === 'string' ? item.helperConnectedAt : undefined,
    completedAt: typeof item.completedAt === 'string' ? item.completedAt : undefined,
    pairingCodeHash: typeof item.pairingCodeHash === 'string' ? item.pairingCodeHash : undefined,
    pairingUsedAt: typeof item.pairingUsedAt === 'string' ? item.pairingUsedAt : undefined,
    helperInstanceId: typeof item.helperInstanceId === 'string' ? item.helperInstanceId : undefined,
  };
}

export async function getLocalImportTask(taskId: string): Promise<LocalImportTaskRecord> {
  const task = await prisma.operationLog.findFirst({
    where: { id: taskId, action: 'local_import_task_created', targetType: 'local_import_task', targetId: taskId },
    select: { id: true, userId: true, createdAt: true, detail: true },
  });
  if (!task?.userId) throw new LocalImportError('导入任务不存在', 404, 'TASK_NOT_FOUND');
  return { id: task.id, userId: task.userId, createdAt: task.createdAt, detail: parseTaskDetail(task.detail) };
}

export async function assertTicketTask(ticket: LocalImportTicketPayload, taskId: string) {
  if (ticket.taskId !== taskId) throw new LocalImportError('任务票据与任务不匹配', 403, 'TASK_MISMATCH');
  const task = await getLocalImportTask(taskId);
  const expiresAt = new Date(task.detail.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new LocalImportError('导入任务已过期', 410, 'TASK_EXPIRED');
  if (task.userId !== ticket.userId
    || task.detail.workOrderId !== ticket.workOrderId
    || task.detail.categoryId !== ticket.categoryId
    || task.detail.handshakeId !== ticket.handshakeId
    || task.detail.maxFiles !== ticket.maxFiles
    || task.detail.maxFileBytes !== ticket.maxFileBytes
    || task.detail.maxTotalBytes !== ticket.maxTotalBytes) {
    throw new LocalImportError('导入任务票据绑定信息不一致', 403, 'TASK_MISMATCH');
  }
  const activeUser = await prisma.user.findFirst({ where: { id: ticket.userId, isActive: true }, select: { id: true } });
  if (!activeUser) throw new LocalImportError('任务创建账号已停用，请重新登录后创建任务', 403, 'TASK_USER_INACTIVE');
  return task;
}

function assertBoundHelper(ticket: LocalImportTicketPayload, task: LocalImportTaskRecord) {
  if (!task.detail.helperInstanceId
    || !ticket.helperInstanceId
    || task.detail.helperInstanceId !== ticket.helperInstanceId) {
    throw new LocalImportError('助手未绑定此导入任务，请重新连接', 403, 'HELPER_NOT_BOUND');
  }
}

export function bearerTicket(req: NextRequest) {
  const authorization = req.headers.get('authorization') || '';
  return authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
}

export async function requireHelperTask(req: NextRequest, taskId: string) {
  const payload = verifyLocalImportTicket(bearerTicket(req));
  const task = await assertTicketTask(payload, taskId);
  assertBoundHelper(payload, task);
  return { payload, task };
}

export async function requireTaskViewer(req: NextRequest, taskId: string) {
  const ticket = bearerTicket(req);
  if (ticket) return requireHelperTask(req, taskId);
  const user = await currentUser();
  if (!user) throw new LocalImportError('未登录或登录已过期', 401, 'UNAUTHORIZED');
  const task = await getLocalImportTask(taskId);
  if (task.userId !== user.id) throw new LocalImportError('无权查看此导入任务', 403, 'TASK_FORBIDDEN');
  return { payload: null, task };
}

type LocalImportTransaction = Prisma.TransactionClient;

function requireHelperInstanceId(value: string) {
  const helperInstanceId = value.trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(helperInstanceId)) {
    throw new LocalImportError('导入助手版本过旧，请下载最新助手后重试', 400, 'HELPER_INSTANCE_INVALID');
  }
  return helperInstanceId;
}

function taskFromRow(row: { id: string; userId: string | null; createdAt: Date; detail: Prisma.JsonValue | null }) {
  if (!row.userId) throw new LocalImportError('导入任务不存在', 404, 'TASK_NOT_FOUND');
  return { id: row.id, userId: row.userId, createdAt: row.createdAt, detail: parseTaskDetail(row.detail) };
}

async function lockLocalImportTask(tx: LocalImportTransaction, taskId: string) {
  await tx.$queryRaw<Array<{ lockResult: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${`local-import-task:${taskId}`}))::text AS "lockResult"
  `;
}

function assertTicketMatchesTask(ticket: LocalImportTicketPayload, task: LocalImportTaskRecord) {
  if (ticket.taskId !== task.id
    || task.userId !== ticket.userId
    || task.detail.workOrderId !== ticket.workOrderId
    || task.detail.categoryId !== ticket.categoryId
    || task.detail.handshakeId !== ticket.handshakeId
    || task.detail.maxFiles !== ticket.maxFiles
    || task.detail.maxFileBytes !== ticket.maxFileBytes
    || task.detail.maxTotalBytes !== ticket.maxTotalBytes) {
    throw new LocalImportError('导入任务票据绑定信息不一致', 403, 'TASK_MISMATCH');
  }
}

async function bindLocalImportTask(
  tx: LocalImportTransaction,
  task: LocalImportTaskRecord,
  helperInstanceId: string,
  method: 'one_time_code' | 'protocol_handoff',
) {
  const resolution = resolveLocalImportHelperBinding(task.detail, helperInstanceId, new Date());
  if (resolution.outcome === 'expired') {
    throw new LocalImportError('任务已过期，请在网页重新创建', 410, 'TASK_EXPIRED');
  }
  if (resolution.outcome === 'used_by_other_helper') {
    throw new LocalImportError('任务码已被其他助手使用，请在网页重新创建', 409, 'PAIRING_CODE_USED_BY_OTHER_HELPER');
  }

  const activeUser = await tx.user.findFirst({ where: { id: task.userId, isActive: true }, select: { id: true } });
  if (!activeUser) throw new LocalImportError('任务创建账号已停用，请重新创建任务', 403, 'TASK_USER_INACTIVE');

  const detail = resolution.detail;
  const changed = resolution.outcome === 'connected'
    || task.detail.state !== detail.state
    || task.detail.pairingUsedAt !== detail.pairingUsedAt
    || task.detail.helperInstanceId !== detail.helperInstanceId
    || task.detail.helperConnectedAt !== detail.helperConnectedAt;
  if (changed) {
    await tx.operationLog.update({
      where: { id: task.id },
      data: { detail: detail as unknown as Prisma.InputJsonValue },
    });
  }
  if (resolution.outcome === 'connected') {
    await tx.operationLog.create({
      data: {
        userId: task.userId,
        action: method === 'one_time_code' ? 'local_import_task_paired' : 'local_import_helper_connected',
        targetType: 'local_import_task',
        targetId: task.id,
        detail: { method },
      },
    });
  }

  const expiresAt = new Date(detail.expiresAt);
  const ticket = createLocalImportTicket({
    taskId: task.id,
    workOrderId: detail.workOrderId,
    categoryId: detail.categoryId,
    userId: task.userId,
    handshakeId: detail.handshakeId,
    expiresAt,
    maxFiles: detail.maxFiles,
    maxFileBytes: detail.maxFileBytes,
    maxTotalBytes: detail.maxTotalBytes,
    helperInstanceId,
  });
  return {
    task: { ...task, detail },
    ticket,
    alreadyConnected: resolution.outcome === 'already_connected',
  };
}

export async function pairLocalImportTask(code: string, rawHelperInstanceId: string) {
  if (!/^\d{6,8}$/.test(code)) throw new LocalImportError('任务码无效或已过期', 401, 'PAIRING_CODE_INVALID');
  const helperInstanceId = requireHelperInstanceId(rawHelperInstanceId);
  const pairingCodeHash = hashLocalImportPairingCode(code);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ lockResult: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${`local-import-pairing:${pairingCodeHash}`}))::text AS "lockResult"
    `;
    const candidate = await tx.operationLog.findFirst({
      where: {
        action: 'local_import_task_created',
        targetType: 'local_import_task',
        createdAt: { gte: new Date(Date.now() - (LOCAL_IMPORT_TASK_TTL_SECONDS + 60) * 1000) },
        detail: { path: ['pairingCodeHash'], equals: pairingCodeHash },
      },
      select: { id: true },
    });
    if (!candidate) throw new LocalImportError('任务码无效或已过期', 401, 'PAIRING_CODE_INVALID');

    await lockLocalImportTask(tx, candidate.id);
    const row = await tx.operationLog.findUnique({
      where: { id: candidate.id },
      select: { id: true, userId: true, createdAt: true, detail: true },
    });
    if (!row) throw new LocalImportError('任务码无效或已过期', 401, 'PAIRING_CODE_INVALID');
    const task = taskFromRow(row);
    if (task.detail.pairingCodeHash !== pairingCodeHash) {
      throw new LocalImportError('任务码无效或已过期', 401, 'PAIRING_CODE_INVALID');
    }
    return bindLocalImportTask(tx, task, helperInstanceId, 'one_time_code');
  });
}

export async function connectLocalImportTask(
  taskId: string,
  ticket: LocalImportTicketPayload,
  rawHelperInstanceId: string,
) {
  const helperInstanceId = requireHelperInstanceId(rawHelperInstanceId);
  return prisma.$transaction(async (tx) => {
    await lockLocalImportTask(tx, taskId);
    const row = await tx.operationLog.findFirst({
      where: { id: taskId, action: 'local_import_task_created', targetType: 'local_import_task', targetId: taskId },
      select: { id: true, userId: true, createdAt: true, detail: true },
    });
    if (!row) throw new LocalImportError('导入任务不存在', 404, 'TASK_NOT_FOUND');
    const task = taskFromRow(row);
    assertTicketMatchesTask(ticket, task);
    if (ticket.helperInstanceId && ticket.helperInstanceId !== helperInstanceId) {
      throw new LocalImportError('助手实例与任务票据不匹配', 403, 'HELPER_INSTANCE_MISMATCH');
    }
    return bindLocalImportTask(tx, task, helperInstanceId, 'protocol_handoff');
  });
}

export async function updateLocalImportTaskState(task: LocalImportTaskRecord, state: string) {
  if (!LOCAL_IMPORT_ALLOWED_STATES.has(state)) throw new LocalImportError('任务状态不正确', 400, 'INVALID_TASK_STATE');
  const now = new Date().toISOString();
  const detail: LocalImportTaskDetail = {
    ...task.detail,
    state,
    helperConnectedAt: task.detail.helperConnectedAt || (state === 'connected' ? now : undefined),
    completedAt: state === 'completed' ? now : task.detail.completedAt,
  };
  await prisma.operationLog.update({ where: { id: task.id }, data: { detail: detail as unknown as Prisma.InputJsonValue } });
  return detail;
}

function eventDetail(value: Prisma.JsonValue | null) {
  return jsonObject(value);
}

export async function localImportTaskSummary(task: LocalImportTaskRecord): Promise<LocalImportTaskSummary> {
  const events = await prisma.operationLog.findMany({
    where: {
      targetType: 'local_import_task',
      targetId: task.id,
      action: { in: ['import_file_from_local_helper', 'local_import_duplicate_skipped', 'local_import_file_failed'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { action: true, detail: true },
  });
  let successCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;
  let uploadedBytes = 0;
  let latestFileId: string | null = null;
  const successKeys = new Set<string>();
  const duplicateKeys = new Set<string>();
  const failedKeys = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const detail = eventDetail(event.detail);
    const fileKey = detail.fileName && detail.sha256Prefix
      ? `${String(detail.fileName)}:${String(detail.sha256Prefix)}`
      : `event:${index}`;
    if (event.action === 'import_file_from_local_helper') {
      if (!successKeys.has(fileKey)) {
        successKeys.add(fileKey);
        if (typeof detail.fileSize === 'number') uploadedBytes += detail.fileSize;
      }
      failedKeys.delete(fileKey);
      if (typeof detail.resourceFileId === 'string') latestFileId = detail.resourceFileId;
    } else if (event.action === 'local_import_duplicate_skipped') {
      duplicateKeys.add(fileKey);
      failedKeys.delete(fileKey);
    } else if (event.action === 'local_import_file_failed') {
      if (!successKeys.has(fileKey) && !duplicateKeys.has(fileKey)) failedKeys.add(fileKey);
    }
  }
  successCount = successKeys.size;
  duplicateCount = duplicateKeys.size;
  failedCount = failedKeys.size;
  const expired = new Date(task.detail.expiresAt).getTime() <= Date.now();
  return {
    state: expired ? 'expired' : task.detail.state,
    successCount,
    duplicateCount,
    failedCount,
    processedCount: successCount + duplicateCount + failedCount,
    uploadedBytes,
    latestFileId,
  };
}

export async function localImportTaskData(task: LocalImportTaskRecord) {
  const [workOrder, category, summary] = await Promise.all([
    prisma.workOrder.findFirst({
      where: { id: task.detail.workOrderId, deletedAt: null },
      select: { id: true, code: true, specification: true, customerName: true, productName: true },
    }),
    prisma.resourceCategory.findUnique({
      where: { id: task.detail.categoryId },
      select: { id: true, code: true, name: true },
    }),
    localImportTaskSummary(task),
  ]);
  if (!workOrder || !category) throw new LocalImportError('任务目标工单或分类不存在', 404, 'TASK_TARGET_NOT_FOUND');
  return {
    taskId: task.id,
    createdAt: task.createdAt.toISOString(),
    expiresAt: task.detail.expiresAt,
    limits: {
      maxFiles: task.detail.maxFiles,
      maxFileBytes: task.detail.maxFileBytes,
      maxTotalBytes: task.detail.maxTotalBytes,
    },
    workOrder: {
      id: workOrder.id,
      displayCode: displayWorkOrderCode(workOrder),
      customerName: workOrder.customerName || '未设置',
      productName: workOrder.productName,
    },
    category,
    summary,
    pairingAvailable: !task.detail.pairingUsedAt && summary.state !== 'expired',
  };
}

export function localImportErrorResponse(error: unknown) {
  if (error instanceof LocalImportError) {
    return { status: error.status, body: { ok: false, error: error.message, code: error.code } };
  }
  return { status: 500, body: { ok: false, error: '本地导入服务异常，请稍后重试', code: 'LOCAL_IMPORT_SERVER_ERROR' } };
}
