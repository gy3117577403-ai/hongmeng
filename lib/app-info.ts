export const APP_NAME = '杭连协同平台';
export const APP_VERSION = process.env.APP_VERSION?.trim() || 'v1.17.0';
export const APP_REVISION = process.env.APP_REVISION?.trim() || process.env.GITHUB_SHA?.trim() || 'local';

export function appInfo() {
  return {
    name: APP_NAME,
    version: APP_VERSION,
    revision: APP_REVISION,
  };
}
