const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

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
    validate: async response => validateNativeJsonResponse(response, 'native system status'),
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
    validate: async response => validateNativeJsonResponse(response, 'native download ticket'),
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
];

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url, {
    method: check.method || 'GET',
    headers: check.headers,
    body: check.body,
    redirect: 'follow',
  });
  if (!response.ok && !check.allowHttpError) throw new Error(`${check.name} returned HTTP ${response.status}`);
  await check.validate(response);
  console.log(`[OK] ${check.name} ${url}`);
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
