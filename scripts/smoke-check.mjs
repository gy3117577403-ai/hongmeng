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
    name: 'readiness',
    path: '/api/ready',
    validate: async response => {
      const body = await response.json();
      if (!body.ok || !body.database?.ok || !body.storage?.ok) throw new Error('database or object storage is not ready');
    },
  },
  {
    name: 'manifest',
    path: '/manifest.webmanifest',
    validate: async response => {
      const body = await response.json();
      if (!body.name || !['standalone', 'fullscreen'].includes(body.display)) throw new Error('manifest is missing PWA fields');
    },
  },
  {
    name: 'login page',
    path: '/login',
    validate: async response => {
      const body = await response.text();
      if (!body.includes('杭连协同平台')) throw new Error('login page content check failed');
    },
  },
  {
    name: 'PDF.js packed Chinese CMap',
    path: '/pdfjs/cmaps/GBK-EUC-H.bcmap',
    validate: async response => {
      const body = await response.arrayBuffer();
      if (body.byteLength === 0) throw new Error('PDF.js Chinese CMap is empty');
    },
  },
  {
    name: 'PDF.js fallback font',
    path: '/pdfjs/standard_fonts/LiberationSans-Regular.ttf',
    validate: async response => {
      const body = await response.arrayBuffer();
      if (body.byteLength === 0) throw new Error('PDF.js fallback font is empty');
    },
  },
  {
    name: 'PDF.js runtime worker',
    path: '/api/pdf-worker',
    validate: async response => {
      const body = await response.text();
      if (body.length < 100_000 || !body.includes('WorkerMessageHandler')) {
        throw new Error('PDF.js runtime worker is missing or incomplete');
      }
    },
  },
];

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
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
