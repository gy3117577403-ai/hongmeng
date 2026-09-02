export type HttpByteRange = { start: number; end: number; length: number };

export function parseHttpByteRange(value: string | null, size: number): HttpByteRange | null | 'invalid' {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return 'invalid';
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid';
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return 'invalid';
    end = Math.min(end, size - 1);
  }
  return { start, end, length: end - start + 1 };
}

