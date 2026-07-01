export function csvEscape(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csv(rows: unknown[][]) {
  return `\uFEFF${rows.map(row => row.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}

export function csvResponse(filename: string, body: string) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

export function jsonDownloadResponse(filename: string, value: unknown) {
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

export function iso(d?: Date | string | null) {
  if (!d) return '';
  const value = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(value.getTime()) ? '' : value.toISOString();
}

export function sanitizeDetail(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeDetail);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|key|database_url|session|credential/i.test(key)) continue;
      out[key] = sanitizeDetail(item);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  return value;
}

export function detailSummary(value: unknown, max = 240) {
  if (!value) return '';
  const text = JSON.stringify(sanitizeDetail(value));
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
