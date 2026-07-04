import type common from '@ohos.app.ability.common';
import router from '@ohos.router';
import { Routes } from '../constants/routes';
import { PreferencesAdapter } from '../platform/PreferencesAdapter';
import { httpClient } from '../services/httpClient';
import * as authApi from '../services/authApi';
import type { User } from '../models/User';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export class AuthStore {
  static token: string = '';
  static user?: User;

  static async init(context: common.UIAbilityContext): Promise<void> {
    const token = await PreferencesAdapter.get(context, TOKEN_KEY, '');
    const userText = await PreferencesAdapter.get(context, USER_KEY, '');
    if (token) {
      AuthStore.token = token;
      httpClient.setToken(token);
    }
    if (userText) {
      try {
        AuthStore.user = JSON.parse(userText) as User;
      } catch (_) {
        AuthStore.user = undefined;
      }
    }
  }

  static async login(context: common.UIAbilityContext, username: string, password: string): Promise<void> {
    const data = await authApi.login(username, password);
    AuthStore.token = data.token;
    AuthStore.user = data.user;
    httpClient.setToken(data.token);
    await PreferencesAdapter.set(context, TOKEN_KEY, data.token);
    await PreferencesAdapter.set(context, USER_KEY, JSON.stringify(data.user));
  }

  static async logout(context?: common.UIAbilityContext): Promise<void> {
    try {
      if (AuthStore.token) {
        await authApi.logout();
      }
    } catch (_) {
    }
    AuthStore.token = '';
    AuthStore.user = undefined;
    httpClient.clearToken();
    if (context) {
      await PreferencesAdapter.remove(context, TOKEN_KEY);
      await PreferencesAdapter.remove(context, USER_KEY);
    }
  }

  static isAuthenticated(): boolean {
    return AuthStore.token.length > 0;
  }

  static async refreshMe(): Promise<void> {
    const data = await authApi.loadMe();
    AuthStore.user = data.user;
  }

  static async handleUnauthorized(context?: common.UIAbilityContext): Promise<void> {
    await AuthStore.logout(context);
    router.replaceUrl({ url: Routes.login });
  }
}
