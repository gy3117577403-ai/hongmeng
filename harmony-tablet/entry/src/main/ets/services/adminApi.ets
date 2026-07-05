import { httpClient, NativeApiBaseResponse } from './httpClient';
import type { ConnectorParameter } from '../models/ConnectorParameter';
import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';

export interface NativeUserAccount {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperationLogItem {
  id: string;
  createdAt: string;
  user: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detailSummary: string;
}

export interface ChangeSnapshotItem {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  changedBy?: string | null;
  createdAt: string;
  summary: string;
}

export interface TrashData {
  workOrders: WorkOrder[];
  resourceFiles: ResourceFile[];
  connectorParameters?: ConnectorParameter[];
}

export interface DiagnosticsHealth {
  ok: boolean;
  database: string;
}

export interface DiagnosticsData {
  exportedAt: string;
  health: DiagnosticsHealth;
  recentLogs: OperationLogItem[];
}

export interface UsersResponse extends NativeApiBaseResponse {
  data: UsersData;
}

export interface UsersData {
  users: NativeUserAccount[];
}

export interface UserResponse extends NativeApiBaseResponse {
  data: UserData;
}

export interface UserData {
  user: NativeUserAccount;
}

export interface LogsResponse extends NativeApiBaseResponse {
  data: LogsData;
}

export interface LogsData {
  logs: OperationLogItem[];
}

export interface SnapshotsResponse extends NativeApiBaseResponse {
  data: SnapshotsData;
}

export interface SnapshotsData {
  snapshots: ChangeSnapshotItem[];
}

export interface TrashResponse extends NativeApiBaseResponse {
  data: TrashData;
}

export interface DiagnosticsResponse extends NativeApiBaseResponse {
  data: DiagnosticsData;
}

export interface CreateUserRequest {
  username: string;
  displayName: string;
  password: string;
}

export interface UpdateUserRequest {
  displayName?: string;
  isActive?: boolean;
  confirmText?: string;
}

export interface ResetPasswordRequest {
  password: string;
  confirmText: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export async function fetchUsers(): Promise<NativeUserAccount[]> {
  const response = await httpClient.get('/api/native/users');
  const parsed = JSON.parse(response.text) as UsersResponse;
  return parsed.data.users;
}

export async function createUser(body: CreateUserRequest): Promise<NativeUserAccount> {
  const response = await httpClient.post('/api/native/users', JSON.stringify(body));
  const parsed = JSON.parse(response.text) as UserResponse;
  return parsed.data.user;
}

export async function updateUser(id: string, body: UpdateUserRequest): Promise<NativeUserAccount> {
  const response = await httpClient.patch(`/api/native/users/${id}`, JSON.stringify(body));
  const parsed = JSON.parse(response.text) as UserResponse;
  return parsed.data.user;
}

export async function resetUserPassword(id: string, body: ResetPasswordRequest): Promise<void> {
  await httpClient.post(`/api/native/users/${id}/reset-password`, JSON.stringify(body));
}

export async function changePassword(body: ChangePasswordRequest): Promise<void> {
  await httpClient.post('/api/native/auth/change-password', JSON.stringify(body));
}

export async function fetchOperationLogs(): Promise<OperationLogItem[]> {
  const response = await httpClient.get('/api/native/operation-logs?limit=100');
  const parsed = JSON.parse(response.text) as LogsResponse;
  return parsed.data.logs;
}

export async function fetchTrash(): Promise<TrashData> {
  const response = await httpClient.get('/api/native/trash');
  const parsed = JSON.parse(response.text) as TrashResponse;
  return parsed.data;
}

export async function restoreWorkOrder(id: string): Promise<void> {
  await httpClient.post(`/api/native/work-orders/${id}/restore`);
}

export async function restoreResourceFile(id: string): Promise<void> {
  await httpClient.post(`/api/native/resource-files/${id}/restore`);
}

export async function restoreConnectorParameter(id: string): Promise<void> {
  await httpClient.post(`/api/native/connector-parameters/${id}/restore`);
}

export async function fetchSnapshots(): Promise<ChangeSnapshotItem[]> {
  const response = await httpClient.get('/api/native/change-snapshots?limit=100');
  const parsed = JSON.parse(response.text) as SnapshotsResponse;
  return parsed.data.snapshots;
}

export async function fetchDiagnostics(): Promise<DiagnosticsData> {
  const response = await httpClient.get('/api/native/system/diagnostics.json');
  const parsed = JSON.parse(response.text) as DiagnosticsResponse;
  return parsed.data;
}
