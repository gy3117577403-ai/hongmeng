export async function qualityRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api/quality-data/' + path, { cache: 'no-store', ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || '操作失败，请重试');
  return body.data as T;
}
export function qualityJson(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
export async function downloadQuality(path: string, filename: string) {
  const response = await fetch('/api/quality-data/' + path, { cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '导出失败，请重试');
  }
  const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
