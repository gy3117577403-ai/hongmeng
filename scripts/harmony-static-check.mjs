import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve('harmony-tablet/entry/src/main/ets');
const expectedApiBaseUrl = 'https://qdowqencjyph.sealoshzh.site';
const expectedNativeVersion = '2.0.0-native-rc.5';
const requiredPageRoutes = [
  'pages/LoginPage',
  'pages/WorkbenchPage',
  'pages/ConnectorParametersPage',
  'pages/SettingsPage',
];

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

const sensitiveRules = [
  { name: 'DATABASE_URL secret', pattern: /\bDATABASE_URL\b/ },
  { name: 'SESSION_SECRET secret', pattern: /\bSESSION_SECRET\b/ },
  { name: 'S3 secret key', pattern: /\bS3_SECRET\b|\bS3_SECRET_KEY\b|\bAWS_SECRET_ACCESS_KEY\b/ },
  { name: 'passwordHash exposure', pattern: /\bpasswordHash\b/ },
  { name: 'OpenAI style secret key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
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

function fail(message) {
  failed = true;
  console.error(`[FAIL] ${message}`);
}

function assertFileExists(filePath) {
  if (!existsSync(path.resolve(filePath))) {
    fail(`missing required file: ${filePath}`);
  }
}

function assertTextIncludes(filePath, expected, label) {
  const text = readFileSync(path.resolve(filePath), 'utf8');
  if (!text.includes(expected)) {
    fail(`${label}: ${filePath} does not include ${expected}`);
  }
}

function assertTextExcludes(filePath, unexpected, label) {
  const text = readFileSync(path.resolve(filePath), 'utf8');
  if (text.includes(unexpected)) {
    fail(`${label}: ${filePath} still includes ${unexpected}`);
  }
}

function assertGitignoreIncludes(pattern) {
  const text = readFileSync(path.resolve('.gitignore'), 'utf8');
  if (!text.includes(pattern)) {
    fail(`.gitignore is missing ${pattern}`);
  }
}

function scanSensitiveFile(filePath) {
  const text = readFileSync(path.resolve(filePath), 'utf8');
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of sensitiveRules) {
      if (rule.pattern.test(line)) {
        fail(`${rule.name}: ${filePath}:${i + 1}`);
      }
      rule.pattern.lastIndex = 0;
    }
  }
}

function scanUndefinedThisMethods(filePath) {
  const text = readFileSync(path.resolve(filePath), 'utf8');
  const definedMethods = new Set();
  const methodPattern = /^\s*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*:\s*[^=;]+[{]/gm;
  let methodMatch = methodPattern.exec(text);
  while (methodMatch !== null) {
    definedMethods.add(methodMatch[1]);
    methodMatch = methodPattern.exec(text);
  }

  const callPattern = /\bthis\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let callMatch = callPattern.exec(text);
  while (callMatch !== null) {
    const methodName = callMatch[1];
    if (!definedMethods.has(methodName)) {
      fail(`undefined this method call: ${filePath} -> this.${methodName}()`);
    }
    callMatch = callPattern.exec(text);
  }
}

function isPageFile(filePath) {
  return filePath.includes('/pages/');
}

let failed = false;

const requiredFiles = [
  'harmony-tablet/AppScope/app.json5',
  'harmony-tablet/entry/src/main/module.json5',
  'harmony-tablet/entry/src/main/ets/entryability/EntryAbility.ets',
  'harmony-tablet/entry/src/main/ets/pages/LoginPage.ets',
  'harmony-tablet/entry/src/main/ets/pages/WorkbenchPage.ets',
  'harmony-tablet/entry/src/main/ets/pages/ConnectorParametersPage.ets',
  'harmony-tablet/entry/src/main/ets/pages/SettingsPage.ets',
  'harmony-tablet/entry/src/main/ets/constants/api.ets',
  'harmony-tablet/oh-package.json5',
  'harmony-tablet/build-profile.json5',
  'harmony-tablet/hvigorfile.ts',
];

for (const file of requiredFiles) {
  assertFileExists(file);
}

assertTextIncludes('harmony-tablet/entry/src/main/ets/constants/api.ets', expectedApiBaseUrl, 'API_BASE_URL check');
assertTextIncludes('harmony-tablet/AppScope/app.json5', `"versionName": "${expectedNativeVersion}"`, 'Harmony app versionName check');
assertTextIncludes('harmony-tablet/oh-package.json5', `"version": "${expectedNativeVersion}"`, 'Harmony package version check');
assertTextIncludes('app/api/native/system/status/route.ts', `version: 'v${expectedNativeVersion}'`, 'native system status version check');
assertTextIncludes('app/api/native/search/route.ts', 'nativeFileDto(file, user.id)', 'native search file DTO check');
assertTextExcludes('app/api/native/search/route.ts', 'serializeResourceFile', 'native search must not use web file serializer');
assertTextIncludes('app/api/native/trash/route.ts', 'nativeFileDto(file, user.id)', 'native trash file DTO check');
assertTextExcludes('app/api/native/trash/route.ts', 'serializeResourceFile', 'native trash must not use web file serializer');
assertTextIncludes('lib/native-api.ts', '/^\\/api\\/native\\/resource-files\\/[^/]+\\/(content|download)$/.test(path)', 'native resource download ticket allowlist check');
assertTextIncludes('lib/native-api.ts', '/^\\/api\\/native\\/work-orders\\/[^/]+\\/download-all$/.test(path)', 'native work order package ticket allowlist check');
assertTextIncludes('lib/native-api.ts', '/^\\/api\\/native\\/connector-parameter-files\\/[^/]+\\/download$/.test(path)', 'native connector attachment ticket allowlist check');
assertTextIncludes('lib/native-api.ts', "path === '/api/native/connector-parameters/export.csv'", 'native connector export ticket allowlist check');
assertTextIncludes('lib/native-api.ts', "path === '/api/native/connector-parameters/template.csv'", 'native connector template ticket allowlist check');
assertTextIncludes('harmony-tablet/entry/src/main/module.json5', '"type": "entry"', 'entry module check');
assertTextIncludes('harmony-tablet/entry/src/main/module.json5', '"mainElement": "EntryAbility"', 'EntryAbility check');
assertTextIncludes('harmony-tablet/entry/src/main/module.json5', '"deviceTypes": ["tablet"]', 'tablet device check');
assertTextIncludes('harmony-tablet/entry/src/main/module.json5', '"startWindowIcon": "$media:app_icon"', 'startWindowIcon check');
assertTextIncludes('harmony-tablet/entry/src/main/module.json5', '"startWindowBackground": "$color:start_window_background"', 'startWindowBackground check');
assertTextIncludes('harmony-tablet/entry/src/main/ets/entryability/EntryAbility.ets', "loadContent('pages/LoginPage')", 'EntryAbility initial page check');

for (const page of requiredPageRoutes) {
  assertTextIncludes('harmony-tablet/entry/src/main/resources/base/profile/main_pages.json', `"${page}"`, `main_pages route check ${page}`);
}

assertTextIncludes('harmony-tablet/entry/src/main/ets/constants/routes.ets', "login: 'pages/LoginPage'", 'login route constant check');
assertTextIncludes('harmony-tablet/entry/src/main/ets/constants/routes.ets', "workbench: 'pages/WorkbenchPage'", 'workbench route constant check');
assertTextIncludes('harmony-tablet/entry/src/main/ets/constants/routes.ets', "connectorParameters: 'pages/ConnectorParametersPage'", 'connector route constant check');
assertTextIncludes('harmony-tablet/entry/src/main/ets/constants/routes.ets', "settings: 'pages/SettingsPage'", 'settings route constant check');

const gitignorePatterns = [
  'harmony-tablet/oh_modules/',
  'harmony-tablet/build/',
  'harmony-tablet/.hvigor/',
  'harmony-tablet/.idea/',
  'harmony-tablet/local.properties',
  'node_modules/',
  '.next/',
  '.env',
  '.env.local',
];

for (const pattern of gitignorePatterns) {
  assertGitignoreIncludes(pattern);
}

const stagedFiles = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const forbiddenStagedFiles = [
  'harmony-tablet/build-profile.json5',
  'harmony-tablet/local.properties',
];

for (const file of stagedFiles) {
  if (forbiddenStagedFiles.includes(file) || file.startsWith('harmony-tablet/oh_modules/') || file.startsWith('harmony-tablet/build/') || file.startsWith('harmony-tablet/.hvigor/') || file.startsWith('harmony-tablet/.idea/')) {
    fail(`forbidden Harmony local/generated file is staged: ${file}`);
  }
}

const files = listFiles(rootDir);

const sensitiveScanFiles = [
  'harmony-tablet/AppScope/app.json5',
  'harmony-tablet/oh-package.json5',
  'harmony-tablet/entry/oh-package.json5',
  'harmony-tablet/entry/src/main/module.json5',
  'harmony-tablet/entry/src/main/resources/base/element/string.json',
  'harmony-tablet/entry/src/main/resources/base/profile/main_pages.json',
];

for (const file of sensitiveScanFiles) {
  scanSensitiveFile(file);
}

for (const file of files) {
  scanSensitiveFile(relative(file));
}

for (const file of files) {
  const rel = relative(file);
  if (isPageFile(rel)) {
    scanUndefinedThisMethods(rel);
  }
}

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

console.log(`Harmony static check passed. Checked ${files.length} ArkTS files and project constraints.`);
