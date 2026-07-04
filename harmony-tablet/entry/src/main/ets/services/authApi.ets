import { httpClient } from './httpClient';
import type { User } from '../models/User';

export interface LoginData {
  token: string;
  user: User;
}

export async function login(username: string, password: string): Promise<LoginData> {
  return httpClient.post<LoginData>('/api/native/auth/login', { username, password });
}

export async function loadMe(): Promise<{ user: User }> {
  return httpClient.get<{ user: User }>('/api/native/auth/me');
}

export async function logout(): Promise<void> {
  await httpClient.post('/api/native/auth/logout', {});
}
