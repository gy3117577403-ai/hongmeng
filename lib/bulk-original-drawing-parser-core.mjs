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

export function dateLikeSpecificationReason(value) {
  const spec = text(value);
  if (!spec) return '';
  const datePart = String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}`;
  if (new RegExp(`^${datePart}$`).test(spec)) return '文件名只识别到日期，不是有效规格';
  if (new RegExp(`^${datePart}\\s+\\d{1,2}[:.]\\d{1,2}(?::\\d{1,2})?$`).test(spec)) {
    return '文件名只识别到日期时间，不是有效规格';
  }
  return '';
}

export function invalidSpecificationReason(value) {
  const spec = text(value);
  if (!spec) return '规格为空';
  const dateReason = dateLikeSpecificationReason(spec);
  if (dateReason) return dateReason;
  if (/^(图纸|扫描件|最终版|最终|新建|文件|资料|原图|图片)$/i.test(spec)) return '规格不能是通用文件名';
  if (/^[\u4e00-\u9fff\s（）()]+$/.test(spec)) return '规格不能是纯中文标题';
  if (spec.length < 3 && !(/[A-Za-z].*\d|\d.*[A-Za-z]/.test(spec))) return '规格过短且缺少字母数字组合';
  if (!/[A-Za-z]/.test(spec) && !/\d{3,}/.test(spec)) return '规格缺少有效字母或数字编号';
  return '';
}

export function isInvalidSpecification(value) {
  return !!invalidSpecificationReason(value);
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
  const invalidReason = invalidSpecificationReason(rawSpec);
  if (invalidReason) {
    return {
      specification: '',
      productName: cleanOriginalDrawingProductName(base),
      source: 'invalid_specification',
      invalidReason,
    };
  }
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
    invalidReason: '',
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
    invalidReason: '',
  };
}

export function extractOriginalDrawingSpecWithExisting(fileName, existingSpecs) {
  const base = baseFileName(fileName);
  const normalizedBase = base.toUpperCase();
  const specs = Array.isArray(existingSpecs) ? existingSpecs : [];
  const existing = specs.find(spec => text(spec) && !isInvalidSpecification(spec) && normalizedBase.includes(text(spec).toUpperCase()));
  if (existing) {
    const specText = text(existing);
    const at = normalizedBase.indexOf(specText.toUpperCase());
    return {
      specification: specText,
      productName: cleanOriginalDrawingProductName(`${base.slice(0, at)}${base.slice(at + specText.length)}`),
      source: 'existing_specification',
      invalidReason: '',
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
  else if (!extracted.specification) reason = extracted.invalidReason || '无法识别规格';

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
    invalidSpecificationReason: extracted.invalidReason || '',
    suspectedNonOriginal,
    reason,
    warnings,
  };
}
