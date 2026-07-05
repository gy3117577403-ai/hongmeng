import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve('harmony-tablet/entry/src/main/ets');

const rules = [
  { name: 'WebView usage', pattern: /\bWebView\b|webview/ },
  { name: 'TextEncoder usage', pattern: /\bTextEncoder\b/ },
  { name: 'delete operator', pattern: /\bdelete\s+/ },
  { name: 'unknown type usage', pattern: /(?:[:<,(]|as\s+)\s*unknown\b/ },
  { name: 'any type usage', pattern: /(?:[:<,(]|as\s+)\s*any\b/ },
  { name: 'Object.keys or Object.entries', pattern: /\bObject\.(keys|entries)\s*\(/ },
  { name: 'object spread', pattern: /{\s*\.\.\.|,\s*\.\.\.[A-Za-z_$]/ },
  { name: 'anonymous Promise object type', pattern: /Promise\s*<\s*{/ },
  { name: 'anonymous Array object type', pattern: /Array\s*<\s*{/ },
  { name: 'Record object map type', pattern: /\bRecord\s*</ },
  { name: 'Row.minHeight usage', pattern: /Row\s*\(\s*\)\s*\.minHeight|\.minHeight\s*\(/ },
  { name: 'development TODO text', pattern: /TODO|待适配|待补齐|DevEco 真机环境补齐/ },
  { name: 'mock wording', pattern: /\bmock\b/i },
];

function listFiles(dir) {
  const result = [];
  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...listFiles(fullPath));
    } else if (fullPath.endsWith('.ets')) {
      result.push(fullPath);
    }
  }
  return result;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

let failed = false;
const files = listFiles(rootDir);

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        failed = true;
        console.error(`[FAIL] ${rule.name}: ${relative(file)}:${i + 1}`);
        console.error(`       ${line.trim()}`);
      }
      rule.pattern.lastIndex = 0;
    }
  }
}

if (failed) {
  console.error('Harmony static check failed.');
  process.exit(1);
}

console.log(`Harmony static check passed. Checked ${files.length} ArkTS files.`);
