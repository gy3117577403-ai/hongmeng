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
];

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${check.name} returned HTTP ${response.status}`);
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
