import { httpClient, NativeApiBaseResponse } from './httpClient';
import type { User } from '../models/User';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginData {
  token: string;
  user: User;
}

export interface LoginResponse extends NativeApiBaseResponse {
  data: LoginData;
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
  const response = await httpClient.post('/api/native/auth/login', JSON.stringify(body));
  const parsed = JSON.parse(response.text) as LoginResponse;
  return parsed.data;
}

export async function loadMe(): Promise<MeData> {
  const response = await httpClient.get('/api/native/auth/me');
  const parsed = JSON.parse(response.text) as MeResponse;
  return parsed.data;
}

export async function logout(): Promise<void> {
  await httpClient.post('/api/native/auth/logout');
}
