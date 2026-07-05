const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const nativeSmokeToken = process.env.NATIVE_SMOKE_TOKEN || '';
const expectedNativeVersion = 'v2.0.0-native-rc.5';

async function validateNativeJsonResponse(response, name) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(`${name} returned HTML with HTTP ${response.status}`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error(`${name} returned non-JSON content-type ${contentType || '(empty)'}`);
  }
  const body = await response.json();
  if (typeof body.ok !== 'boolean') throw new Error(`${name} response is missing boolean ok field`);
  return body;
}

async function validateNativeSystemStatus(response) {
  const body = await validateNativeJsonResponse(response, 'native system status');
  if (body.ok === true) {
    const version = body.data && body.data.app ? body.data.app.version : '';
    if (version !== expectedNativeVersion) {
      throw new Error(`native system status version is ${version || '(missing)'}, expected ${expectedNativeVersion}`);
    }
  }
}

async function validateNativeDownloadTicket(response) {
  const body = await validateNativeJsonResponse(response, 'native download ticket');
  if (body.ok === true) {
    const url = body.data && body.data.url ? body.data.url : '';
    if (!url.includes('/api/native/connector-parameters/export.csv') || !url.includes('ticket=')) {
      throw new Error('native download ticket response is missing export path or ticket');
    }
  }
}

function nativeJsonCheck(name, path, options = {}) {
  const check = {
    name,
    path,
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, name),
  };
  if (options.method) check.method = options.method;
  if (options.jsonBody) {
    check.headers = { 'content-type': 'application/json' };
    check.body = JSON.stringify(options.jsonBody);
  }
  return check;
}

const checks = [
  {
    name: 'health',
    path: '/api/health',
    validate: async response => {
      const body = await response.json();
      if (!body.ok) throw new Error('health response ok is not true');
    },
  },
  {
    name: 'manifest',
    path: '/manifest.webmanifest',
    validate: async response => {
      const body = await response.json();
      if (!body.name || body.display !== 'standalone') throw new Error('manifest is missing PWA fields');
    },
  },
  {
    name: 'login page',
    path: '/login',
    validate: async response => {
      const body = await response.text();
      if (!body.includes('工单资料库')) throw new Error('login page content check failed');
    },
  },
  {
    name: 'native system status',
    path: '/api/native/system/status',
    allowHttpError: true,
    validate: async response => validateNativeSystemStatus(response),
  },
  {
    name: 'native login format',
    path: '/api/native/auth/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '__smoke__', password: '__smoke__' }),
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native login'),
  },
  {
    name: 'native download ticket format',
    path: '/api/native/download-ticket?path=/api/native/connector-parameters/export.csv',
    allowHttpError: true,
    validate: async response => validateNativeDownloadTicket(response),
  },
  {
    name: 'native auth me format',
    path: '/api/native/auth/me',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native auth me'),
  },
  {
    name: 'native work orders format',
    path: '/api/native/work-orders',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native work orders'),
  },
  {
    name: 'native search format',
    path: '/api/native/search?keyword=__smoke__',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native search'),
  },
  {
    name: 'native connector parameters format',
    path: '/api/native/connector-parameters',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native connector parameters'),
  },
  {
    name: 'native connector attachments format',
    path: '/api/native/connector-parameter-files',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native connector attachments'),
  },
  {
    name: 'native connector import batches format',
    path: '/api/native/connector-parameter-import-batches',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native connector import batches'),
  },
  {
    name: 'native users format',
    path: '/api/native/users',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native users'),
  },
  {
    name: 'native operation logs format',
    path: '/api/native/operation-logs',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native operation logs'),
  },
  {
    name: 'native trash format',
    path: '/api/native/trash',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native trash'),
  },
  {
    name: 'native change snapshots format',
    path: '/api/native/change-snapshots',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native change snapshots'),
  },
  {
    name: 'native diagnostics format',
    path: '/api/native/system/diagnostics.json',
    allowHttpError: true,
    validate: async response => validateNativeJsonResponse(response, 'native diagnostics'),
  },
  nativeJsonCheck('native auth logout format', '/api/native/auth/logout', { method: 'POST', jsonBody: { smoke: true } }),
  nativeJsonCheck('native change password format', '/api/native/auth/change-password', {
    method: 'POST',
    jsonBody: { currentPassword: '__smoke__', newPassword: '__smoke__', confirmPassword: '__smoke__' },
  }),
  nativeJsonCheck('native create user format', '/api/native/users', {
    method: 'POST',
    jsonBody: { username: '__smoke__', displayName: 'smoke', password: '__smoke__' },
  }),
  nativeJsonCheck('native update user format', '/api/native/users/__smoke__', {
    method: 'PATCH',
    jsonBody: { isActive: true },
  }),
  nativeJsonCheck('native reset user password format', '/api/native/users/__smoke__/reset-password', {
    method: 'POST',
    jsonBody: { password: '__smoke__' },
  }),
  nativeJsonCheck('native create work order format', '/api/native/work-orders', {
    method: 'POST',
    jsonBody: { code: '__smoke__', productName: 'smoke' },
  }),
  nativeJsonCheck('native work order detail format', '/api/native/work-orders/__smoke__'),
  nativeJsonCheck('native update work order format', '/api/native/work-orders/__smoke__', {
    method: 'PATCH',
    jsonBody: { productName: 'smoke' },
  }),
  nativeJsonCheck('native delete work order format', '/api/native/work-orders/__smoke__', {
    method: 'DELETE',
    jsonBody: { code: '__smoke__', confirmText: 'CONFIRM' },
  }),
  nativeJsonCheck('native restore work order format', '/api/native/work-orders/__smoke__/restore', { method: 'POST', jsonBody: { smoke: true } }),
  nativeJsonCheck('native work order resources format', '/api/native/work-orders/__smoke__/resources'),
  nativeJsonCheck('native work order package format', '/api/native/work-orders/__smoke__/download-all'),
  nativeJsonCheck('native resource upload format', '/api/native/resource-files/upload', { method: 'POST' }),
  nativeJsonCheck('native resource content format', '/api/native/resource-files/__smoke__/content'),
  nativeJsonCheck('native resource download format', '/api/native/resource-files/__smoke__/download'),
  nativeJsonCheck('native update resource file format', '/api/native/resource-files/__smoke__', {
    method: 'PATCH',
    jsonBody: { displayName: 'smoke' },
  }),
  nativeJsonCheck('native delete resource file format', '/api/native/resource-files/__smoke__', {
    method: 'DELETE',
    jsonBody: { confirmText: 'DELETE', nameSuffix: 'smoke' },
  }),
  nativeJsonCheck('native restore resource file format', '/api/native/resource-files/__smoke__/restore', { method: 'POST', jsonBody: { smoke: true } }),
  nativeJsonCheck('native create connector parameter format', '/api/native/connector-parameters', {
    method: 'POST',
    jsonBody: { model: '__smoke__' },
  }),
  nativeJsonCheck('native update connector parameter format', '/api/native/connector-parameters/__smoke__', {
    method: 'PATCH',
    jsonBody: { model: '__smoke__' },
  }),
  nativeJsonCheck('native delete connector parameter format', '/api/native/connector-parameters/__smoke__', {
    method: 'DELETE',
    jsonBody: { confirmText: 'DELETE' },
  }),
  nativeJsonCheck('native restore connector parameter format', '/api/native/connector-parameters/__smoke__/restore', { method: 'POST', jsonBody: { smoke: true } }),
  nativeJsonCheck('native connector batch format', '/api/native/connector-parameters/batch', {
    method: 'POST',
    jsonBody: { ids: ['__smoke__'], action: 'highlight' },
  }),
  nativeJsonCheck('native connector template format', '/api/native/connector-parameters/template.csv'),
  nativeJsonCheck('native connector export format', '/api/native/connector-parameters/export.csv'),
  nativeJsonCheck('native connector import preview format', '/api/native/connector-parameters/import/preview', {
    method: 'POST',
    jsonBody: { text: '' },
  }),
  nativeJsonCheck('native connector import commit format', '/api/native/connector-parameters/import/commit', {
    method: 'POST',
    jsonBody: { rows: [], importDuplicates: false },
  }),
  nativeJsonCheck('native connector batch rollback format', '/api/native/connector-parameter-import-batches/__smoke__/rollback', {
    method: 'POST',
    jsonBody: { confirmText: 'ROLLBACK' },
  }),
  nativeJsonCheck('native connector attachment upload format', '/api/native/connector-parameter-files/upload', { method: 'POST' }),
  nativeJsonCheck('native connector attachment download format', '/api/native/connector-parameter-files/__smoke__/download'),
  nativeJsonCheck('native connector attachment delete format', '/api/native/connector-parameter-files/__smoke__', {
    method: 'DELETE',
    jsonBody: { confirmText: 'DELETE' },
  }),
];

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url, {
    method: check.method || 'GET',
    headers: requestHeaders(check),
    body: check.body,
    redirect: 'follow',
  });
  if (!response.ok && !check.allowHttpError) throw new Error(`${check.name} returned HTTP ${response.status}`);
  await check.validate(response);
  console.log(`[OK] ${check.name} ${url}`);
}

function requestHeaders(check) {
  const headers = check.headers ? { ...check.headers } : {};
  if (check.path.startsWith('/api/native/') && nativeSmokeToken.length > 0) {
    headers.authorization = `Bearer ${nativeSmokeToken}`;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

console.log(`Smoke target: ${baseUrl}`);

let failed = false;
for (const check of checks) {
  try {
    await runCheck(check);
  } catch (error) {
    failed = true;
    console.error(`[FAIL] ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) {
  console.error('Smoke check failed.');
  process.exit(1);
}

console.log('Smoke check passed.');
