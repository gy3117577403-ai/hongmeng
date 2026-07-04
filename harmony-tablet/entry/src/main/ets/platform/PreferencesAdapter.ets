import preferences from '@ohos.data.preferences';
import type common from '@ohos.app.ability.common';

const PREF_NAME = 'native_auth';
const memoryStore: Map<string, string> = new Map<string, string>();

export class PreferencesAdapter {
  static async get(context: common.UIAbilityContext | undefined, key: string, fallback: string = ''): Promise<string> {
    if (!context) return memoryStore.get(key) || fallback;
    try {
      const pref = await preferences.getPreferences(context, PREF_NAME);
      return String(await pref.get(key, fallback));
    } catch (_) {
      // TODO(DevEco): keep this memory fallback only for command-line scaffold validation.
      return memoryStore.get(key) || fallback;
    }
  }

  static async set(context: common.UIAbilityContext | undefined, key: string, value: string): Promise<void> {
    memoryStore.set(key, value);
    if (!context) return;
    try {
      const pref = await preferences.getPreferences(context, PREF_NAME);
      await pref.put(key, value);
      await pref.flush();
    } catch (_) {
      // TODO(DevEco): verify preferences persistence on real Harmony tablet.
    }
  }

  static async remove(context: common.UIAbilityContext | undefined, key: string): Promise<void> {
    memoryStore.delete(key);
    if (!context) return;
    try {
      const pref = await preferences.getPreferences(context, PREF_NAME);
      await pref.delete(key);
      await pref.flush();
    } catch (_) {
      // TODO(DevEco): verify preferences removal on real Harmony tablet.
    }
  }
}
