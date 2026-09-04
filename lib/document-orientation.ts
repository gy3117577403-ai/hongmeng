import { normalizePreviewRotation } from '@/lib/preview-gestures';

/** Quarter turns relative to each page's intrinsic PDF/EXIF orientation. */
export type PageRotations = Record<string, number>;
export type DocumentOrientationSnapshot = { revision: number; pageRotations: PageRotations };
export const MAX_ORIENTATION_PAGES = 2000;

export function parsePageRotations(value: unknown, pageCount = MAX_ORIENTATION_PAGES): PageRotations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('页面方向格式无效');
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_ORIENTATION_PAGES) throw new Error('文件页数超出支持范围');
  const entries = Object.entries(value);
  if (entries.length > pageCount) throw new Error('页面方向数量超出文件页数');
  const result: PageRotations = {};
  for (const [key, rotation] of entries) {
    const page = Number(key);
    if (!Number.isInteger(page) || String(page) !== key || page < 1 || page > pageCount) throw new Error('页面方向包含无效页码');
    if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) throw new Error('旋转角度只能为 0、90、180、270 度');
    if (rotation) result[key] = rotation;
  }
  return result;
}

export function rotateDocumentPages(current: PageRotations, page: number, delta: number, pageCount: number, all = false): PageRotations {
  const result = { ...current };
  for (const index of all ? Array.from({ length: pageCount }, (_, i) => i + 1) : [page]) {
    const rotation = normalizePreviewRotation((result[index] || 0) + delta);
    if (rotation) result[index] = rotation;
    else delete result[index];
  }
  return result;
}

export function samePageRotations(left: PageRotations, right: PageRotations): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => (left[key] || 0) === (right[key] || 0));
}

export function documentDisplaySettingsUrl(source: string): string | null {
  const path = source.split('?')[0];
  return /^\/api\/(?:resource-files\/[^/]+|drawing-library\/files\/[^/]+|sample-photos\/[^/]+)\/content$/.test(path)
    ? path.replace(/\/content$/, '/display-settings') : null;
}

/** Old print records deliberately keep intrinsic orientation, never today's settings. */
export function orientationFromPrintSnapshot(snapshot: unknown, fileId: string): DocumentOrientationSnapshot {
  const empty = { revision: 0, pageRotations: {} };
  if (!snapshot || typeof snapshot !== 'object' || !('documentOrientations' in snapshot)) return empty;
  const settings = snapshot.documentOrientations;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return empty;
  const setting = (settings as Record<string, unknown>)[fileId];
  if (!setting || typeof setting !== 'object' || !('pageRotations' in setting)) return empty;
  const revision = 'revision' in setting && Number.isSafeInteger(setting.revision) ? Number(setting.revision) : 0;
  return { revision, pageRotations: parsePageRotations(setting.pageRotations) };
}
