export type ConnectorManualChapterCandidate = {
  title: string;
  pageStart: number;
  pageEnd: number;
};

export type ConnectorManualMetadataConfidence = 'confirmed' | 'detected' | 'needs_review';

export type ConnectorManualMetadataConfidenceMap = {
  defaultTitle: ConnectorManualMetadataConfidence;
  detectedTitle: ConnectorManualMetadataConfidence;
  manufacturer: ConnectorManualMetadataConfidence;
  family: ConnectorManualMetadataConfidence;
  revision: ConnectorManualMetadataConfidence;
  issuedAt: ConnectorManualMetadataConfidence;
  models: ConnectorManualMetadataConfidence;
  chapters: ConnectorManualMetadataConfidence;
};

export type ConnectorManualParserInput = {
  fileName: string;
  relativePath?: string;
  fileSize: number;
  mimeType?: string;
  metadataTitle?: string;
  firstPageText?: string;
  secondPageText?: string;
  fullText?: string;
};

export type ConnectorManualParserResult = {
  defaultTitle: string;
  detectedTitle: string;
  manufacturerCandidate: string;
  familyCandidate: string;
  revisionCandidate: string;
  issuedAtCandidate: string;
  modelCandidates: string[];
  keywordCandidates: string[];
  chapterCandidates: ConnectorManualChapterCandidate[];
  metadataConfidence: ConnectorManualMetadataConfidenceMap;
  warnings: string[];
};

const genericTitles = new Set(['说明书', '组装说明书', 'assembly manual', 'manual', 'untitled']);
export const GENERIC_CONNECTOR_MANUAL_MANUFACTURERS = [
  '组装说明', '组装说明书', '操作说明', '产品说明', '目录', '说明书', '装配说明',
] as const;
const genericManufacturerKeys = new Set(GENERIC_CONNECTOR_MANUAL_MANUFACTURERS.map(value => value.toLocaleLowerCase('zh-CN').replace(/\s+/g, '')));
const ignoredModelTokens = new Set([
  'A4', 'PDF', 'ISO9001', 'PAGE1', 'PAGE2', 'REV01', 'REV02', 'VERSION1', 'VERSION2',
]);
const chapterKeywords = [
  '产品零件清单', '零件清单', '剥线', '压接端子', '压接', '装配线缆', '线缆装配', '灌胶',
  '作业指导书', '指导书', '注意事项', '辅料规格', '安装', '拆卸', '检验', '测试', '包装',
];

function cleanText(value: string | null | undefined): string {
  return String(value || '').replace(/\u0000/g, '').replace(/[\t ]+/g, ' ').replace(/\r/g, '').trim();
}

export function isGenericConnectorManualManufacturer(value: string | null | undefined): boolean {
  const normalized = cleanText(value).toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
  return !!normalized && genericManufacturerKeys.has(normalized);
}

export function sanitizeConnectorManualManufacturer(value: string | null | undefined): string {
  const cleaned = cleanText(value);
  return isGenericConnectorManualManufacturer(cleaned) ? '' : cleaned;
}

export function connectorManualDefaultTitle(fileName: string): string {
  return cleanText(fileName).replace(/\.(?:pdf|jpe?g|png|webp)$/i, '').trim() || '未命名说明书';
}

function effectiveDirectories(relativePath: string): string[] {
  const parts = cleanText(relativePath).replace(/\\/g, '/').split('/').filter(Boolean);
  const directories = parts.slice(0, -1);
  return directories.length > 1 ? directories.slice(1) : directories;
}

function firstUsefulTitle(input: ConnectorManualParserInput): string {
  const metadataTitle = cleanText(input.metadataTitle);
  if (metadataTitle && !genericTitles.has(metadataTitle.toLowerCase()) && metadataTitle.length <= 160) return metadataTitle;
  const lines = `${cleanText(input.firstPageText)}\n${cleanText(input.secondPageText)}`
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const explicit = lines.find(line => /(?:组装|装配|安装|assembly).{0,12}(?:说明书|手册|manual)/i.test(line) && line.length >= 4 && line.length <= 160);
  if (explicit) return explicit.replace(/^[\s\d._-]+/, '').trim();
  return '';
}

function revisionFromText(text: string): string {
  const revision = text.match(/\b(?:REV(?:ISION)?\s*[-_.]?\s*[A-Z0-9]+|V\s*\d+(?:\.\d+)*|R\s*\d{1,3})\b/i)?.[0];
  if (revision) return revision.replace(/\s+/g, ' ').replace(/^rev(?:ision)?/i, 'Rev').replace(/^v\s*/i, 'V').replace(/^r\s*/i, 'R');
  const yearEdition = text.match(/(?:19|20)\d{2}\s*版/)?.[0];
  return yearEdition ? yearEdition.replace(/\s+/g, '') : '';
}

function dateFromText(text: string): string {
  const patterns = [
    /\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    /((?:19|20)\d{2})年(\d{1,2})月(\d{1,2})日/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return '';
}

function normalizeModel(value: string): string {
  return value.replace(/[（(].*?[)）]/g, '').replace(/^[^A-Z0-9]+|[^A-Z0-9/_-]+$/gi, '').toUpperCase();
}

function modelCandidates(fileName: string, text: string): string[] {
  const source = `${connectorManualDefaultTitle(fileName)}\n${text}`.toUpperCase();
  const values: string[] = [];
  const paired = source.matchAll(/\b([A-Z]{2,}[A-Z0-9_-]*?)(\d+)\((\d+)\)/g);
  for (const match of paired) {
    values.push(`${match[1]}${match[2]}`, `${match[1]}${match[3]}`);
  }
  const tokens = source.match(/[A-Z][A-Z0-9]*(?:[-_/][A-Z0-9]+)*\d[A-Z0-9]*(?:[-_/][A-Z0-9]+)*/g) || [];
  values.push(...tokens);
  const fileUpper = connectorManualDefaultTitle(fileName).toUpperCase();
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = normalizeModel(raw);
    if (!value || value.length < 4 || value.length > 48 || ignoredModelTokens.has(value)) continue;
    if (/^(?:19|20)\d{6}$/.test(value) || /^\d+$/.test(value)) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([value, count]) => count >= 2 || fileUpper.includes(value))
    .map(([value]) => value)
    .slice(0, 24);
}

function manufacturerFromText(text: string): string {
  const amphenol = text.match(/\bAmphenol(?:\s+[A-Za-z0-9&.-]+){0,3}/i)?.[0];
  if (amphenol) return sanitizeConnectorManualManufacturer(amphenol);
  const labeled = text.match(/(?:制造商|生产商|manufacturer|company)\s*[:：]\s*([^\n]{2,80})/i)?.[1];
  return sanitizeConnectorManualManufacturer(labeled).slice(0, 160);
}

function chaptersFromText(text: string): ConnectorManualChapterCandidate[] {
  const rows = cleanText(text).split('\n').map(row => row.trim()).filter(Boolean);
  const result: ConnectorManualChapterCandidate[] = [];
  for (const row of rows) {
    const keyword = chapterKeywords.find(value => row.includes(value));
    if (!keyword) continue;
    const range = row.match(/(?:第\s*)?(\d{1,3})\s*(?:[-~至到]\s*(\d{1,3}))?\s*页?\s*$/);
    if (!range) continue;
    const pageStart = Number(range[1]);
    const pageEnd = Number(range[2] || range[1]);
    if (pageStart < 1 || pageEnd < pageStart || pageEnd > 999) continue;
    if (!result.some(item => item.title === keyword && item.pageStart === pageStart)) result.push({ title: keyword, pageStart, pageEnd });
  }
  return result.slice(0, 100);
}

export function parseConnectorManual(input: ConnectorManualParserInput): ConnectorManualParserResult {
  const defaultTitle = connectorManualDefaultTitle(input.fileName);
  const directories = effectiveDirectories(input.relativePath || input.fileName);
  const firstPageText = cleanText(input.firstPageText);
  const secondPageText = cleanText(input.secondPageText);
  const fullText = cleanText(input.fullText);
  const searchableText = `${defaultTitle}\n${firstPageText}\n${secondPageText}\n${fullText}`;
  const detectedTitle = firstUsefulTitle(input);
  const directoryManufacturer = cleanText(directories[0]);
  const manufacturerCandidate = sanitizeConnectorManualManufacturer(directoryManufacturer) || manufacturerFromText(firstPageText);
  const familyCandidate = cleanText(directories[1]);
  const revisionCandidate = revisionFromText(searchableText);
  const issuedAtCandidate = dateFromText(searchableText);
  const models = modelCandidates(input.fileName, searchableText);
  const chapters = chaptersFromText(`${firstPageText}\n${secondPageText}\n${fullText}`);
  const keywordCandidates = Array.from(new Set([
    ...models,
    ...chapterKeywords.filter(keyword => searchableText.includes(keyword)),
  ])).slice(0, 40);
  const warnings: string[] = [];
  if (isGenericConnectorManualManufacturer(directoryManufacturer)) warnings.push(`父目录“${directoryManufacturer}”是通用说明词，未作为制造商写入`);
  if (!detectedTitle) warnings.push('未识别封面标题，保留文件名作为说明书名称');
  if (!revisionCandidate) warnings.push('未识别版本，可导入后在待完善中补充');
  if (!issuedAtCandidate) warnings.push('未识别发布日期');
  if (!models.length) warnings.push('未识别连接器型号，不自动关联参数');
  if (!chapters.length) warnings.push('未识别带页码章节，可导入后手工维护目录');
  return {
    defaultTitle,
    detectedTitle,
    manufacturerCandidate,
    familyCandidate,
    revisionCandidate,
    issuedAtCandidate,
    modelCandidates: models,
    keywordCandidates,
    chapterCandidates: chapters,
    metadataConfidence: {
      defaultTitle: 'confirmed',
      detectedTitle: detectedTitle ? 'detected' : 'needs_review',
      manufacturer: manufacturerCandidate ? 'detected' : 'needs_review',
      family: familyCandidate ? 'detected' : 'needs_review',
      revision: revisionCandidate ? 'detected' : 'needs_review',
      issuedAt: issuedAtCandidate ? 'detected' : 'needs_review',
      models: models.length ? 'detected' : 'needs_review',
      chapters: chapters.length ? 'detected' : 'needs_review',
    },
    warnings,
  };
}
