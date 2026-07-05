const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

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
    validate: async response => {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`native system status returned non-JSON content-type ${contentType || '(empty)'}`);
      }
      const body = await response.json();
      if (typeof body.ok !== 'boolean') throw new Error('native system status response is missing boolean ok field');
    },
  },
  {
    name: 'native login format',
    path: '/api/native/auth/login',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '__smoke__', password: '__smoke__' }),
    allowHttpError: true,
    validate: async response => {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error(`native login returned HTML with HTTP ${response.status}`);
      }
      if (!contentType.includes('application/json')) {
        throw new Error(`native login returned non-JSON content-type ${contentType || '(empty)'}`);
      }
      const body = await response.json();
      if (typeof body.ok !== 'boolean') throw new Error('native login response is missing boolean ok field');
    },
  },
  {
    name: 'native download ticket format',
    path: '/api/native/download-ticket?path=/api/native/connector-parameters/export.csv',
    allowHttpError: true,
    validate: async response => {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        throw new Error(`native download ticket returned HTML with HTTP ${response.status}`);
      }
      if (!contentType.includes('application/json')) {
        throw new Error(`native download ticket returned non-JSON content-type ${contentType || '(empty)'}`);
      }
      const body = await response.json();
      if (typeof body.ok !== 'boolean') throw new Error('native download ticket response is missing boolean ok field');
    },
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
