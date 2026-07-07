export const supportedOriginalDrawingExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);
export const ignoredOriginalDrawingExtensions = new Set(['.tmp', '.part', '.crdownload']);

const suspectedNonOriginalKeywords = [
  '成品图',
  '成品图片',
  '成品照片',
  '实物图',
  '实物照片',
  'SOP',
  '作业指导书',
  '指导书',
  '注意事项',
  '辅料规格',
];

function text(value) {
  return String(value || '').trim();
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/');
}

function fileNameFromPath(value) {
  const normalized = normalizePath(value);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function extensionOf(fileName) {
  const name = text(fileName);
  const at = name.lastIndexOf('.');
  if (at <= 0) return '';
  return name.slice(at).toLowerCase();
}

function baseFileName(fileName) {
  const name = fileNameFromPath(fileName);
  const ext = extensionOf(name);
  return ext ? name.slice(0, name.length - ext.length) : name;
}

function firstFolder(relativePath) {
  const normalized = normalizePath(relativePath);
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '';
}

function isIgnoredName(fileName) {
  const name = text(fileName);
  return name.startsWith('.') || name.startsWith('~$');
}

function hasSuspiciousKeyword(fileName) {
  const name = text(fileName);
  return suspectedNonOriginalKeywords.some(keyword => {
    if (keyword === 'SOP') return /SOP/i.test(name);
    return name.includes(keyword);
  });
}

export function cleanOriginalDrawingProductName(value) {
  let result = text(value);
  for (let index = 0; index < 5; index += 1) {
    const before = result;
    result = result
      .replace(/^[-_\s:：、]+/, '')
      .replace(/^dwg\d+\s*/i, '')
      .replace(/[（(]\d+[）)]$/, '')
      .replace(/^[（(\[]\s*[A-Z0-9]{1,4}\s*[）)\]]\s*/i, '')
      .replace(/^[A-Z0-9]{1,4}[版版本]+\s*/i, '')
      .replace(/^[（(\[]\s*/, '')
      .replace(/\s*[）)\]]$/, '')
      .replace(/[（(]\s*[）)]/g, '')
      .trim();
    if (result === before) break;
  }
  return result;
}

function resultFromMatch(base, match, source) {
  const rawSpec = match[0];
  const at = typeof match.index === 'number'
    ? match.index
    : base.toUpperCase().indexOf(rawSpec.toUpperCase());
  const productText = at >= 0
    ? `${base.slice(0, at)}${base.slice(at + rawSpec.length)}`
    : base.replace(rawSpec, '');
  return {
    specification: rawSpec.toUpperCase(),
    productName: cleanOriginalDrawingProductName(productText),
    source,
  };
}

export function extractOriginalDrawingSpec(fileName) {
  const base = baseFileName(fileName);
  const patterns = [
    { source: 'd_version', pattern: /D\d+(?:-\d+)+-V\d+/i },
    { source: 'boa', pattern: /BOA[A-Z0-9]+/i },
    { source: 'p_series', pattern: /P\d[A-Z0-9]*/i },
    { source: 'known_prefix', pattern: /(?:GRQ|XL|TY|HBTZ)[A-Z0-9-]+/i },
    { source: 'alpha_dotted', pattern: /[A-Z]+\d+(?:\.\d+)+(?:-[A-Z0-9]+)+(?=$|[-_\s（(]|[\u4e00-\u9fff])/i },
    { source: 'dotted', pattern: /\d+(?:\.\d+)+(?:-[A-Z0-9]+)+(?=$|[-_\s（(]|[\u4e00-\u9fff])/i },
    { source: 'one_ca', pattern: /1CA\d+-[A-Z0-9]+(?:-[A-Z0-9]+)*(?=$|[-_\s（(]|[\u4e00-\u9fff])/i },
    { source: 'hyphenated', pattern: /[A-Z0-9]+(?:\.[A-Z0-9]+)?(?:-[A-Z0-9]+)+(?=$|[-_\s（(]|[\u4e00-\u9fff])/i },
    { source: 'compact', pattern: /[A-Z]+[A-Z0-9]*\d[A-Z0-9]*(?=$|[-_\s（(]|[\u4e00-\u9fff])/i },
  ];

  for (const item of patterns) {
    const match = base.match(item.pattern);
    if (match?.[0] && match[0].length >= 4) {
      return resultFromMatch(base, match, item.source);
    }
  }

  return {
    specification: '',
    productName: cleanOriginalDrawingProductName(base),
    source: 'unmatched',
  };
}

export function extractOriginalDrawingSpecWithExisting(fileName, existingSpecs) {
  const base = baseFileName(fileName);
  const normalizedBase = base.toUpperCase();
  const specs = Array.isArray(existingSpecs) ? existingSpecs : [];
  const existing = specs.find(spec => text(spec) && normalizedBase.includes(text(spec).toUpperCase()));
  if (existing) {
    const specText = text(existing);
    const at = normalizedBase.indexOf(specText.toUpperCase());
    return {
      specification: specText,
      productName: cleanOriginalDrawingProductName(`${base.slice(0, at)}${base.slice(at + specText.length)}`),
      source: 'existing_specification',
    };
  }
  return extractOriginalDrawingSpec(fileName);
}

export function parseOriginalDrawingFile(input) {
  const relativePath = normalizePath(input?.relativePath || '');
  const fileName = fileNameFromPath(input?.fileName || relativePath);
  const customerFolder = text(input?.folderName || input?.customerFolder || firstFolder(relativePath));
  const ext = extensionOf(fileName);
  const size = Number(input?.size || 0);
  const supported = supportedOriginalDrawingExtensions.has(ext);
  const ignored = ignoredOriginalDrawingExtensions.has(ext) || size <= 0 || isIgnoredName(fileName);
  const extracted = extractOriginalDrawingSpec(fileName);
  const suspectedNonOriginal = hasSuspiciousKeyword(fileName);
  const warnings = [];
  if (suspectedNonOriginal) warnings.push('疑似非原图');
  let reason = '';
  if (!customerFolder) reason = '缺少客户文件夹';
  else if (!supported) reason = '不支持的文件类型';
  else if (ignored) reason = '临时或空文件';
  else if (suspectedNonOriginal) reason = '疑似非原图';
  else if (!extracted.specification) reason = '无法识别规格';

  return {
    relativePath,
    fileName,
    customerFolder,
    ext,
    size,
    supported,
    ignored,
    specification: extracted.specification,
    productName: extracted.productName,
    source: extracted.source,
    suspectedNonOriginal,
    reason,
    warnings,
  };
}
