export type ConnectorManualTocItem = {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  sortOrder: number;
  createdBy?: string;
  createdAt?: string;
};

export type ConnectorManualTocSuggestion = {
  title: string;
  pageStart: number;
  pageEnd: number;
  source: 'outline' | 'document-text' | 'current-page';
};

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableManualTocId(title: string, pageStart: number, pageEnd: number, index = 0): string {
  return `toc_${shortHash(`${title}|${pageStart}|${pageEnd}|${index}`)}`;
}

export function normalizeManualToc(value: unknown, pageCount?: number | null): { items: ConnectorManualTocItem[]; error?: string } {
  if (value === null || value === undefined || value === '') return { items: [] };
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return { items: [], error: '章节目录不是有效 JSON' };
    }
  }
  if (!Array.isArray(raw)) return { items: [], error: '章节目录必须是数组' };
  if (raw.length > 100) return { items: [], error: '章节目录不能超过 100 条' };
  const items: ConnectorManualTocItem[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const row = raw[index];
    if (!row || typeof row !== 'object') return { items: [], error: `第 ${index + 1} 条章节格式不正确` };
    const record = row as Record<string, unknown>;
    const title = String(record.title ?? '').trim().slice(0, 160);
    const pageStart = Number(record.pageStart);
    const pageEnd = Number(record.pageEnd ?? record.pageStart);
    if (!title || !Number.isInteger(pageStart) || !Number.isInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart) {
      return { items: [], error: `第 ${index + 1} 条章节的标题或页码不正确` };
    }
    if (pageCount && pageEnd > pageCount) return { items: [], error: `第 ${index + 1} 条章节页码超过文件总页数` };
    const suppliedId = String(record.id ?? '').trim();
    const sortOrderValue = Number(record.sortOrder);
    const createdAt = String(record.createdAt ?? '').trim();
    const createdBy = String(record.createdBy ?? '').trim();
    items.push({
      id: /^toc_[a-z0-9_-]{3,80}$/i.test(suppliedId) ? suppliedId : stableManualTocId(title, pageStart, pageEnd, index),
      title,
      pageStart,
      pageEnd,
      sortOrder: Number.isInteger(sortOrderValue) ? sortOrderValue : index,
      ...(createdBy ? { createdBy: createdBy.slice(0, 120) } : {}),
      ...(createdAt && !Number.isNaN(new Date(createdAt).getTime()) ? { createdAt: new Date(createdAt).toISOString() } : {}),
    });
  }
  return { items: sortManualToc(items) };
}

export function sortManualToc(items: ConnectorManualTocItem[]): ConnectorManualTocItem[] {
  return [...items]
    .sort((first, second) => first.sortOrder - second.sortOrder || first.pageStart - second.pageStart || first.title.localeCompare(second.title, 'zh-CN'))
    .map((item, index) => ({ ...item, sortOrder: index }));
}

export function insertManualTocByPage(items: ConnectorManualTocItem[], additions: ConnectorManualTocItem[]): ConnectorManualTocItem[] {
  return [...items, ...additions]
    .sort((first, second) => first.pageStart - second.pageStart || first.pageEnd - second.pageEnd || first.sortOrder - second.sortOrder)
    .map((item, index) => ({ ...item, sortOrder: index }));
}

export function manualTocDuplicate(items: ConnectorManualTocItem[], title: string, pageStart: number, excludedId = ''): boolean {
  const normalizedTitle = title.trim().toLocaleLowerCase('zh-CN');
  return items.some(item => item.id !== excludedId && item.pageStart === pageStart && item.title.trim().toLocaleLowerCase('zh-CN') === normalizedTitle);
}

function cleanTitle(value: string): string {
  return value
    .replace(/^(?:第\s*)?\d+(?:\s*[.．]\s*\d+){0,3}\s*[、.．)）:-]\s*/u, '')
    .replace(/[\s.．·…]{3,}$/u, '')
    .replace(/^[-—–•·\s]+|[-—–•·\s]+$/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/([\p{L}\p{N}\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
    .trim();
}

function plausibleTitle(value: string): boolean {
  const title = cleanTitle(value);
  if (title.length < 2 || title.length > 60) return false;
  if (/^(目录|contents?|page|第?\s*\d+\s*页)$/iu.test(title)) return false;
  if (/^[\d\s\p{P}\p{S}_]+$/u.test(title)) return false;
  return /[\p{L}\p{Script=Han}]/u.test(title);
}

export function extractManualPageTitleCandidates(lines: string[]): string[] {
  const candidates: string[] = [];
  const add = (value: string): void => {
    const title = cleanTitle(value);
    if (plausibleTitle(title) && !candidates.some(item => item.toLocaleLowerCase('zh-CN') === title.toLocaleLowerCase('zh-CN'))) candidates.push(title);
  };
  for (const line of lines.slice(0, 30)) {
    const trimmed = line.trim();
    const numbered = trimmed.match(/^(?:第\s*)?\d+(?:\.\d+){0,3}\s*[、.．)）:-]?\s*(.{2,56})$/u);
    if (numbered?.[1]) add(numbered[1]);
  }
  for (const line of lines.slice(0, 12)) add(line);
  return candidates.slice(0, 6);
}

export function extractManualTocSuggestions(lines: string[], pageCount: number): ConnectorManualTocSuggestion[] {
  const suggestions: ConnectorManualTocSuggestion[] = [];
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, ' ').trim();
    const pageMatch = normalized.match(/(\d{1,3})\s*$/u);
    if (!pageMatch || pageMatch.index === undefined) continue;
    const rawTitle = normalized.slice(0, pageMatch.index).trim();
    const hasLeader = /[.．·…](?:[\s.．·…]*[.．·…]){2,}\s*$/u.test(rawTitle);
    const hasChapterNumber = /^(?:第\s*)?\d+(?:\s*[.．]\s*\d+){1,3}\s*[、.．)）:-]?/u.test(rawTitle);
    if (!hasLeader && !hasChapterNumber) continue;
    const title = cleanTitle(rawTitle);
    const page = Number(pageMatch[1]);
    if (!plausibleTitle(title) || !Number.isInteger(page) || page < 1 || page > pageCount) continue;
    if (!suggestions.some(item => item.title.toLocaleLowerCase('zh-CN') === title.toLocaleLowerCase('zh-CN') && item.pageStart === page)) {
      suggestions.push({ title, pageStart: page, pageEnd: page, source: 'document-text' });
    }
  }
  return suggestions.slice(0, 40);
}
