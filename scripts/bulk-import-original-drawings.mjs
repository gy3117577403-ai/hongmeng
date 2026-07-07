import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const supportedExts = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);
const ignoredExts = new Set(['.tmp', '.part', '.crdownload']);
const suspectedNonOriginalPattern = /SOP|成品|辅料|说明|注意|指导书/i;
const defaultSource = 'C:\\Users\\31175\\Desktop\\图纸';
const defaultBaseUrl = 'https://qdowqencjyph.sealoshzh.site';
const defaultReportDir = 'reports/bulk-original-drawings';

const args = parseArgs(process.argv.slice(2));
const execute = args.execute === true;
const dryRun = !execute;
const sourceDir = path.resolve(String(args.source || defaultSource));
const reportRoot = path.resolve(String(args.reportDir || defaultReportDir));
const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) > 0 ? Number(args.limit) : 0;
const createMissing = args.createMissing === true;
const strict = args.strict === true;
const allowSuspectedNonOriginal = args.allowSuspectedNonOriginal === true;
const baseUrl = String(args.baseUrl || process.env.BULK_UPLOAD_BASE_URL || defaultBaseUrl).replace(/\/+$/, '');

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--source') parsed.source = values[++index];
    else if (value === '--report-dir') parsed.reportDir = values[++index];
    else if (value === '--limit') parsed.limit = values[++index];
    else if (value === '--base-url') parsed.baseUrl = values[++index];
    else if (value === '--execute') parsed.execute = true;
    else if (value === '--dry-run') parsed.dryRun = true;
    else if (value === '--create-missing') parsed.createMissing = true;
    else if (value === '--strict') parsed.strict = true;
    else if (value === '--allow-suspected-non-original') parsed.allowSuspectedNonOriginal = true;
  }
  return parsed;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(headers, rows) {
  return [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(',')),
  ].join('\n');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeReports(reportDir, data) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, 'summary.json'), `${JSON.stringify(data.summary, null, 2)}\n`, 'utf8');
  await writeFile(path.join(reportDir, 'matched.csv'), csv(['localPath', 'folderName', 'fileName', 'customerName', 'specification', 'productName', 'libraryItemId', 'action', 'warning'], data.matched), 'utf8');
  await writeFile(path.join(reportDir, 'unmatched.csv'), csv(['localPath', 'folderName', 'fileName', 'reason', 'suggestedCustomer', 'suggestedSpecification'], data.unmatched), 'utf8');
  await writeFile(path.join(reportDir, 'duplicates.csv'), csv(['localPath', 'fileName', 'matchedItem', 'reason'], data.duplicates), 'utf8');
  await writeFile(path.join(reportDir, 'uploaded.csv'), csv(['localPath', 'fileName', 'libraryItemId', 'fileId', 'version', 'size', 'mimeType'], data.uploaded), 'utf8');
  await writeFile(path.join(reportDir, 'failed.csv'), csv(['localPath', 'error'], data.failed), 'utf8');
  await writeFile(path.join(reportDir, 'created-items.csv'), csv(['folderName', 'customerName', 'specification', 'productName', 'libraryItemId', 'action'], data.createdItems), 'utf8');
}

async function loadJson(filePath) {
  if (!existsSync(filePath)) return {};
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function loadAliases() {
  const example = await loadJson(path.resolve('config/customer-aliases.example.json')).catch(() => ({}));
  const local = await loadJson(path.resolve('config/customer-aliases.local.json')).catch(() => ({}));
  return { ...example, ...local };
}

async function scanFiles(root) {
  const found = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredName(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const info = await stat(fullPath);
        found.push(toCandidate(root, fullPath, info.size));
        if (limit && found.length >= limit) return;
      }
      if (limit && found.length >= limit) return;
    }
  }
  await walk(root);
  return found;
}

function isIgnoredName(name) {
  return name.startsWith('.') || name.startsWith('~$');
}

function toCandidate(root, fullPath, size) {
  const relative = path.relative(root, fullPath);
  const parts = relative.split(path.sep);
  const folderName = parts.length > 1 ? parts[0] : '';
  const fileName = path.basename(fullPath);
  const ext = path.extname(fileName).toLowerCase();
  return {
    localPath: fullPath,
    relativePath: relative,
    folderName,
    fileName,
    ext,
    size,
    supported: supportedExts.has(ext),
    ignored: ignoredExts.has(ext) || size <= 0 || isIgnoredName(fileName),
  };
}

function normalizeText(value) {
  return String(value || '').trim();
}

function cleanProductName(value) {
  return normalizeText(value)
    .replace(/^[-_\s]+/, '')
    .replace(/[（(]\s*[）)]/g, '')
    .trim();
}

function baseFileName(fileName) {
  const ext = path.extname(fileName);
  return fileName.slice(0, fileName.length - ext.length);
}

function extractSpecAndProduct(fileName, existingSpecs) {
  const base = baseFileName(fileName);
  const normalizedBase = base.toUpperCase();
  const existing = existingSpecs.find(spec => spec && normalizedBase.includes(spec.toUpperCase()));
  if (existing) {
    const at = normalizedBase.indexOf(existing.toUpperCase());
    return {
      specification: existing,
      productName: cleanProductName(`${base.slice(0, at)}${base.slice(at + existing.length)}`),
      source: 'existing_specification',
    };
  }

  const patterns = [
    /D\d+(?:-\d+)+-V\d+/i,
    /BOA\d+/i,
    /P\d+/i,
    /(?:GRQ|XL|TY|HBTZ)[A-Z0-9-]+/i,
  ];
  for (const pattern of patterns) {
    const match = base.match(pattern);
    if (match?.[0]) {
      return {
        specification: match[0].toUpperCase(),
        productName: cleanProductName(base.replace(match[0], '')),
        source: 'filename',
      };
    }
  }
  return { specification: '', productName: cleanProductName(base), source: 'unmatched' };
}

function libraryKey(customerName, specification) {
  const customer = normalizeText(customerName);
  const spec = normalizeText(specification);
  return customer ? `${customer}::${spec}` : spec;
}

function makeIndex(raw) {
  const items = Array.isArray(raw.items) ? raw.items : [];
  const files = Array.isArray(raw.files) ? raw.files : [];
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  const customerNames = Array.from(new Set(items.map(item => item.customerName).filter(Boolean)));
  const specs = Array.from(new Set(items.map(item => item.specification).filter(Boolean))).sort((a, b) => b.length - a.length);
  const itemByKey = new Map(items.map(item => [libraryKey(item.customerName, item.specification), item]));
  return { items, files, categories, customerNames, specs, itemByKey };
}

function resolveCustomer(folderName, aliases, index) {
  const folder = normalizeText(folderName);
  if (!folder) return { ok: false, reason: '缺少客户文件夹', customerName: '' };
  const alias = normalizeText(aliases[folder]);
  if (alias) return { ok: true, customerName: alias, source: 'alias' };

  const exact = index.customerNames.filter(name => name === folder);
  if (exact.length === 1) return { ok: true, customerName: exact[0], source: 'exact' };

  const contains = index.customerNames.filter(name => name.includes(folder) || folder.includes(name));
  if (contains.length === 1) return { ok: true, customerName: contains[0], source: 'contains' };
  if (contains.length > 1) return { ok: false, reason: '客户简称匹配到多个客户', customerName: '', suggestions: contains.join(' | ') };

  return { ok: false, reason: '无法确认客户，请配置 customer-aliases.local.json', customerName: '' };
}

function mimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function isDuplicate(file, item, drawingCategory, index, plannedDuplicateKeys) {
  const key = `${item.id}::${drawingCategory.id}::${file.fileName}::${file.size}`;
  if (plannedDuplicateKeys.has(key)) return true;
  const found = index.files.find(existing => (
    existing.libraryItemId === item.id
    && existing.categoryId === drawingCategory.id
    && existing.originalName === file.fileName
    && Number(existing.size) === Number(file.size)
  ));
  if (found) return true;
  plannedDuplicateKeys.add(key);
  return false;
}

async function readPasswordHidden(promptText) {
  if (!input.isTTY) {
    const rl = createInterface({ input, output });
    const value = await rl.question(promptText);
    rl.close();
    return value;
  }
  output.write(promptText);
  input.setRawMode(true);
  input.resume();
  let value = '';
  return new Promise(resolve => {
    const onData = chunk => {
      const char = chunk.toString('utf8');
      if (char === '\r' || char === '\n') {
        input.setRawMode(false);
        input.off('data', onData);
        output.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u0003') process.exit(130);
      if (char === '\b' || char === '\x7f') value = value.slice(0, -1);
      else value += char;
    };
    input.on('data', onData);
  });
}

async function loginIfNeeded() {
  const username = process.env.BULK_UPLOAD_USERNAME || '';
  let password = process.env.BULK_UPLOAD_PASSWORD || '';
  if (!execute && !username && !password) {
    return { cookie: '', authenticated: false };
  }
  if (!username) throw new Error('缺少 BULK_UPLOAD_USERNAME，无法登录批量导入 API');
  if (!password) password = await readPasswordHidden('BULK_UPLOAD_PASSWORD: ');
  if (!password) throw new Error('缺少 BULK_UPLOAD_PASSWORD，无法登录批量导入 API');

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`登录失败：HTTP ${response.status}`);
  const setCookie = response.headers.get('set-cookie') || '';
  const cookie = setCookie.split(/,(?=[^;,]+=)/).map(part => part.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('登录成功但未收到 session cookie');
  return { cookie, authenticated: true };
}

async function apiJson(pathname, cookie, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Cookie: cookie,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}

async function loadRemoteIndex(cookie) {
  if (!cookie) return makeIndex({ items: [], files: [], categories: [] });
  const data = await apiJson('/api/drawing-library/bulk-index', cookie, { method: 'GET' });
  return makeIndex(data.data || {});
}

async function createItem(item, cookie) {
  const data = await apiJson('/api/drawing-library', cookie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: item.customerName,
      specification: item.specification,
      productName: item.productName || '',
      remark: '批量原图导入自动创建',
    }),
  });
  if (!data.item?.id) throw new Error('创建图纸资料记录失败：响应缺少 item.id');
  return data.item;
}

async function uploadOriginal(file, item, drawingCategory, cookie) {
  const buffer = await readFile(file.localPath);
  const body = new FormData();
  body.set('categoryId', drawingCategory.id);
  body.set('categoryName', drawingCategory.name);
  body.set('displayName', file.fileName);
  body.set('remark', '本地批量原图导入');
  body.set('file', new Blob([buffer], { type: mimeType(file.fileName) }), file.fileName);

  const response = await fetch(`${baseUrl}/api/drawing-library/${item.id}/files/upload`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `上传失败：HTTP ${response.status}`);
  return data.file;
}

async function main() {
  if (!existsSync(sourceDir)) throw new Error(`源目录不存在：${sourceDir}`);
  if (execute && process.env.CONFIRM_BULK_ORIGINAL_UPLOAD !== 'YES') {
    throw new Error('正式上传被拒绝：请设置 CONFIRM_BULK_ORIGINAL_UPLOAD=YES');
  }

  const reportDir = path.join(reportRoot, timestamp());
  const aliases = await loadAliases();
  const auth = await loginIfNeeded();
  const index = await loadRemoteIndex(auth.cookie);
  const drawingCategory = index.categories.find(category => category.code === 'drawing' || category.name === '原图') || null;
  if (execute && !drawingCategory) throw new Error('图纸资料库索引中找不到“原图”分类');

  const files = await scanFiles(sourceDir);
  const supportedFiles = files.filter(file => file.supported && !file.ignored);
  const plannedDuplicateKeys = new Set();
  const matched = [];
  const unmatched = [];
  const duplicates = [];
  const uploaded = [];
  const failed = [];
  const createdItems = [];
  let suspectedNonOriginalFiles = 0;
  let skippedFiles = files.length - supportedFiles.length;
  let willCreateItems = 0;

  for (const file of supportedFiles) {
    const warning = suspectedNonOriginalPattern.test(file.fileName) ? '疑似非原图，本轮默认跳过' : '';
    if (warning) suspectedNonOriginalFiles += 1;
    if (warning && !allowSuspectedNonOriginal) {
      skippedFiles += 1;
      unmatched.push({ localPath: file.localPath, folderName: file.folderName, fileName: file.fileName, reason: warning, suggestedCustomer: '', suggestedSpecification: '' });
      continue;
    }

    const customer = resolveCustomer(file.folderName, aliases, index);
    const extracted = extractSpecAndProduct(file.fileName, index.specs);
    if (!customer.ok) {
      unmatched.push({ localPath: file.localPath, folderName: file.folderName, fileName: file.fileName, reason: customer.reason, suggestedCustomer: customer.suggestions || '', suggestedSpecification: extracted.specification });
      continue;
    }
    if (!extracted.specification) {
      unmatched.push({ localPath: file.localPath, folderName: file.folderName, fileName: file.fileName, reason: '无法识别规格', suggestedCustomer: customer.customerName, suggestedSpecification: '' });
      continue;
    }

    const key = libraryKey(customer.customerName, extracted.specification);
    let item = index.itemByKey.get(key) || null;
    let action = 'would_upload';
    if (!item) {
      if (!createMissing) {
        unmatched.push({ localPath: file.localPath, folderName: file.folderName, fileName: file.fileName, reason: auth.authenticated ? '图纸资料库不存在且未使用 --create-missing' : '未登录，无法确认图纸资料库记录', suggestedCustomer: customer.customerName, suggestedSpecification: extracted.specification });
        continue;
      }
      if (strict && customer.source !== 'alias' && customer.source !== 'exact') {
        unmatched.push({ localPath: file.localPath, folderName: file.folderName, fileName: file.fileName, reason: 'strict 模式下客户未被明确确认', suggestedCustomer: customer.customerName, suggestedSpecification: extracted.specification });
        continue;
      }
      action = 'would_create_and_upload';
      willCreateItems += 1;
      item = { id: '', customerName: customer.customerName, specification: extracted.specification, productName: extracted.productName, libraryKey: key };
    }

    const categoryForDuplicate = drawingCategory || { id: 'dry-run-drawing', name: '原图' };
    if (item.id && isDuplicate(file, item, categoryForDuplicate, index, plannedDuplicateKeys)) {
      duplicates.push({ localPath: file.localPath, fileName: file.fileName, matchedItem: `${item.customerName} / ${item.specification}`, reason: '同一图纸资料记录原图分类下已有同名且同大小文件' });
      continue;
    }

    if (dryRun) {
      matched.push({ localPath: file.localPath, folderName: file.folderName, fileName: file.fileName, customerName: customer.customerName, specification: extracted.specification, productName: extracted.productName, libraryItemId: item.id, action, warning: warning.replace('，本轮默认跳过', '') });
      continue;
    }

    try {
      let targetItem = item;
      if (!targetItem.id) {
        targetItem = await createItem(targetItem, auth.cookie);
        index.itemByKey.set(libraryKey(targetItem.customerName, targetItem.specification), targetItem);
        createdItems.push({ folderName: file.folderName, customerName: targetItem.customerName, specification: targetItem.specification, productName: targetItem.productName || '', libraryItemId: targetItem.id, action: 'created' });
      }
      const uploadedFile = await uploadOriginal(file, targetItem, drawingCategory, auth.cookie);
      matched.push({ localPath: file.localPath, folderName: file.folderName, fileName: file.fileName, customerName: targetItem.customerName, specification: targetItem.specification, productName: targetItem.productName || extracted.productName, libraryItemId: targetItem.id, action: 'uploaded', warning: '' });
      uploaded.push({ localPath: file.localPath, fileName: file.fileName, libraryItemId: targetItem.id, fileId: uploadedFile.id || '', version: uploadedFile.version || '', size: uploadedFile.size || uploadedFile.fileSize || file.size, mimeType: uploadedFile.mimeType || mimeType(file.fileName) });
      index.files.push({ libraryItemId: targetItem.id, categoryId: drawingCategory.id, originalName: file.fileName, size: file.size });
    } catch (error) {
      failed.push({ localPath: file.localPath, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const summary = {
    mode: dryRun ? 'dry-run' : 'execute',
    source: sourceDir,
    reportDir,
    scannedFiles: files.length,
    supportedFiles: supportedFiles.length,
    matchedFiles: matched.length,
    unmatchedFiles: unmatched.length,
    duplicateFiles: duplicates.length,
    suspectedNonOriginalFiles,
    willCreateItems: dryRun ? willCreateItems : 0,
    uploadedFiles: uploaded.length,
    failedFiles: failed.length,
    skippedFiles,
    category: '原图',
    authenticated: auth.authenticated,
    baseUrl,
  };

  await writeReports(reportDir, { summary, matched, unmatched, duplicates, uploaded, failed, createdItems });
  console.log('Bulk original drawing import');
  console.log(`Mode: ${summary.mode}`);
  console.log(`Source: ${sourceDir}`);
  console.log(`Report: ${reportDir}`);
  console.log(`Scanned files: ${summary.scannedFiles}`);
  console.log(`Supported files: ${summary.supportedFiles}`);
  console.log(`Matched files: ${summary.matchedFiles}`);
  console.log(`Unmatched files: ${summary.unmatchedFiles}`);
  console.log(`Duplicate files: ${summary.duplicateFiles}`);
  console.log(`Suspected non-original files: ${summary.suspectedNonOriginalFiles}`);
  console.log(`Will create DrawingLibraryItems: ${summary.willCreateItems}`);
  console.log(`Uploaded files: ${summary.uploadedFiles}`);
  console.log(`Failed files: ${summary.failedFiles}`);
  console.log(`Skipped files: ${summary.skippedFiles}`);
  if (dryRun) console.log('DRY RUN ONLY: no files were uploaded and no database rows or S3 objects were changed.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
