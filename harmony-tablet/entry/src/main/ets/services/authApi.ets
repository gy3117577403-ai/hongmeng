import { ApiException, HttpResponseText, httpClient, NativeApiBaseResponse } from './httpClient';
import type { User } from '../models/User';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginData {
  token: string;
  user: User;
}

export interface NativeLoginUserPayload {
  id?: string;
  username?: string;
  displayName?: string | null;
  name?: string | null;
  role?: string | null;
}

export interface NativeLoginDataPayload {
  token?: string;
  user?: NativeLoginUserPayload;
}

export interface LoginResponse extends NativeApiBaseResponse {
  data?: NativeLoginDataPayload;
  token?: string;
  user?: NativeLoginUserPayload;
}

export interface MeData {
  user: User;
}

export interface MeResponse extends NativeApiBaseResponse {
  data: MeData;
}

export async function login(username: string, password: string): Promise<LoginData> {
  const body: LoginRequest = {
    username: username,
    password: password
  };
  try {
    const response = await httpClient.post('/api/native/auth/login', JSON.stringify(body));
    return parseLoginResponse(response);
  } catch (err) {
    if (err instanceof ApiException) {
      logLoginDiagnostics(err.path, err.statusCode, err.contentType, err.bodyText);
      throw err;
    }
    throw new ApiException('登录失败，请稍后重试');
  }
}

export async function loadMe(): Promise<MeData> {
  const response = await httpClient.get('/api/native/auth/me');
  const parsed = JSON.parse(response.text) as MeResponse;
  return parsed.data;
}

export async function logout(): Promise<void> {
  await httpClient.post('/api/native/auth/logout');
}

function parseLoginResponse(response: HttpResponseText): LoginData {
  let parsed: LoginResponse;
  try {
    parsed = JSON.parse(response.bodyText) as LoginResponse;
  } catch (_) {
    logLoginDiagnostics(response.path, response.statusCode, response.contentType, response.bodyText);
    throw new ApiException('服务器返回非 JSON 数据，请检查 API 地址或接口路径', response.statusCode, false, response.path, response.contentType, response.bodyText);
  }

  if (parsed.ok === false || parsed.success === false) {
    const message = loginErrorMessage(parsed);
    logLoginDiagnostics(response.path, response.statusCode, response.contentType, response.bodyText);
    throw new ApiException(message, response.statusCode, false, response.path, response.contentType, response.bodyText, message);
  }

  let token = '';
  let userPayload: NativeLoginUserPayload | undefined = undefined;
  if (parsed.data) {
    token = parsed.data.token || '';
    userPayload = parsed.data.user;
  }
  if (token.length === 0) {
    token = parsed.token || '';
  }
  if (!userPayload) {
    userPayload = parsed.user;
  }

  if (!userPayload || !userPayload.id || !userPayload.username || token.length === 0) {
    logLoginDiagnostics(response.path, response.statusCode, response.contentType, response.bodyText);
    throw new ApiException('登录接口返回缺少 token 或用户信息，请检查服务版本', response.statusCode, false, response.path, response.contentType, response.bodyText);
  }

  const displayName = userPayload.displayName ? userPayload.displayName : userPayload.name;
  const user: User = {
    id: userPayload.id,
    username: userPayload.username,
    displayName: displayName
  };
  const data: LoginData = {
    token: token,
    user: user
  };
  return data;
}

function loginErrorMessage(response: LoginResponse): string {
  if (response.error && response.error.length > 0) return response.error;
  if (response.message && response.message.length > 0) return response.message;
  return '登录失败，请检查账号或密码';
}

function logLoginDiagnostics(path: string, statusCode: number, contentType: string, bodyText: string): void {
  const preview = safeBodyPreview(bodyText);
  console.warn(`[HarmonyLogin] path=${path} status=${statusCode} contentType=${contentType} body=${preview}`);
}

function safeBodyPreview(bodyText: string): string {
  const lower = bodyText.toLowerCase();
  if (lower.indexOf('token') >= 0 ||
    lower.indexOf('bearer') >= 0 ||
    lower.indexOf('password') >= 0 ||
    lower.indexOf('secret') >= 0 ||
    lower.indexOf('session') >= 0 ||
    lower.indexOf('database_url') >= 0 ||
    lower.indexOf('access_key') >= 0 ||
    lower.indexOf('s3_') >= 0) {
    return '[sensitive body hidden]';
  }
  if (bodyText.length > 200) {
    return bodyText.substring(0, 200);
  }
  return bodyText;
}
