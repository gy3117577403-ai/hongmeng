export function safeDecodeFilename(value?: string | null) {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function safeDisplayFilename(file?: { displayName?: string | null; originalName?: string | null } | null) {
  if (!file) return '-';
  const displayName = file.displayName?.trim();
  if (displayName) return displayName;
  return safeDecodeFilename(file.originalName) || file.originalName || '-';
}

export function compactFilename(value: string, max = 24) {
  if (value.length <= max) return value;
  const head = Math.max(8, Math.floor(max * 0.52));
  const tail = Math.max(6, max - head - 3);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
