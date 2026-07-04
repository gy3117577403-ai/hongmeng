import preferences from '@ohos.data.preferences';
import type common from '@ohos.app.ability.common';
import { httpClient } from '../services/httpClient';
import * as authApi from '../services/authApi';
import type { User } from '../models/User';

const PREF_NAME = 'native_auth';
const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export class AuthStore {
  static token: string = '';
  static user?: User;

  static async init(context: common.UIAbilityContext): Promise<void> {
    const pref = await preferences.getPreferences(context, PREF_NAME);
    const token = String(await pref.get(TOKEN_KEY, ''));
    const userText = String(await pref.get(USER_KEY, ''));
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
    const pref = await preferences.getPreferences(context, PREF_NAME);
    await pref.put(TOKEN_KEY, data.token);
    await pref.put(USER_KEY, JSON.stringify(data.user));
    await pref.flush();
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
      const pref = await preferences.getPreferences(context, PREF_NAME);
      await pref.delete(TOKEN_KEY);
      await pref.delete(USER_KEY);
      await pref.flush();
    }
  }
}
