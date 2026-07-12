export const LOCAL_IMPORT_OFFICIAL_ORIGIN = 'https://qdowqencjyph.sealoshzh.site';

const LOCAL_IMPORT_OFFICIAL_HOST = 'qdowqencjyph.sealoshzh.site';

export function normalizeLocalImportServiceOrigin(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Local import service origin is invalid');
  }

  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.hostname.toLowerCase() !== LOCAL_IMPORT_OFFICIAL_HOST
    || (parsed.port && parsed.port !== '443')) {
    throw new Error('Local import service origin is not allowed');
  }

  return LOCAL_IMPORT_OFFICIAL_ORIGIN;
}
