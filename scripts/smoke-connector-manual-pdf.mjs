import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const baseUrl = (process.env.APP_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const username = process.env.SMOKE_ADMIN_USERNAME || 'pdfsmokeadmin';
const initialPassword = process.env.SMOKE_ADMIN_PASSWORD;
const changedPassword = process.env.SMOKE_ADMIN_CHANGED_PASSWORD;
const expectParseFailure = process.env.SMOKE_EXPECT_PARSE_FAILURE === '1';

if (!initialPassword || !changedPassword) {
  throw new Error('SMOKE_ADMIN_PASSWORD and SMOKE_ADMIN_CHANGED_PASSWORD are required');
}

function sessionCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(/hm_session=[^;]+/);
  if (!match) throw new Error('login response did not set hm_session');
  return match[0];
}

async function responseJson(response, action) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${action} returned HTTP ${response.status}: ${body.error || body.message || 'unknown error'}`);
  }
  return body;
}

async function login(password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await responseJson(response, 'login');
  return { body, cookie: sessionCookie(response) };
}

async function createFixturePdf(marker) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(`Connector assembly manual runtime smoke ${marker}`, {
    x: 48,
    y: 780,
    size: 16,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
  return document.save();
}

let cookie;
let manualId = '';
const marker = `${Date.now()}-${process.pid}`;

try {
  const firstLogin = await login(initialPassword);
  cookie = firstLogin.cookie;
  if (firstLogin.body.mustChangePassword) {
    const changeResponse = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: changedPassword,
        confirmPassword: changedPassword,
      }),
    });
    await responseJson(changeResponse, 'change password');
    cookie = (await login(changedPassword)).cookie;
  }

  const createResponse = await fetch(`${baseUrl}/api/connector-assembly-manuals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: baseUrl,
    },
    body: JSON.stringify({
      title: `PDF runtime smoke ${marker}`,
      revision: 'Rev-SMOKE',
      fileMode: 'PDF',
      status: 'smoke',
      keywords: 'runtime smoke pdf worker',
    }),
  });
  const created = await responseJson(createResponse, 'create connector manual');
  manualId = String(created.manual?.id || '');
  const versionId = String(created.manual?.latestVersion?.id || '');
  if (!manualId || !versionId) throw new Error('created connector manual did not include a version');

  const pdfBytes = await createFixturePdf(marker);
  const form = new FormData();
  form.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), `runtime-smoke-${marker}.pdf`);
  const uploadResponse = await fetch(`${baseUrl}/api/connector-assembly-manual-versions/${versionId}/assets/upload`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: baseUrl },
    body: form,
  });
  const uploaded = await responseJson(uploadResponse, 'upload connector manual PDF');
  if (expectParseFailure) {
    if (!uploaded.warning || uploaded.parseStatus !== 'failed' || uploaded.assets?.length !== 1) {
      throw new Error(`PDF fallback did not preserve the asset: ${JSON.stringify(uploaded)}`);
    }
  } else {
    if (uploaded.warning) throw new Error(`PDF upload unexpectedly degraded: ${uploaded.warning}`);
    if (uploaded.pageCount !== 1 || uploaded.parseStatus !== 'parsed' || uploaded.assets?.length !== 1) {
      throw new Error(`unexpected PDF upload result: ${JSON.stringify(uploaded)}`);
    }
  }

  const detailResponse = await fetch(`${baseUrl}/api/connector-assembly-manuals/${manualId}`, {
    headers: { Cookie: cookie },
  });
  const detail = await responseJson(detailResponse, 'load connector manual detail');
  const latestVersion = detail.manual?.latestVersion;
  const expectedParseStatus = expectParseFailure ? 'failed' : 'parsed';
  if (
    latestVersion?.parseStatus !== expectedParseStatus
    || latestVersion?.assets?.length !== 1
    || (!expectParseFailure && latestVersion?.pageCount !== 1)
  ) {
    throw new Error('stored connector manual PDF metadata did not match the expected fixture state');
  }

  const contentResponse = await fetch(`${baseUrl}${latestVersion.assets[0].contentUrl}`, {
    headers: { Cookie: cookie },
  });
  if (!contentResponse.ok || contentResponse.headers.get('content-type') !== 'application/pdf') {
    throw new Error(`connector manual PDF content returned HTTP ${contentResponse.status}`);
  }
  const content = new Uint8Array(await contentResponse.arrayBuffer());
  if (content.length < 5 || new TextDecoder().decode(content.subarray(0, 5)) !== '%PDF-') {
    throw new Error('downloaded connector manual asset is not the uploaded PDF');
  }

  console.log(JSON.stringify({
    ok: true,
    manualId,
    versionId,
    pageCount: uploaded.pageCount,
    parseStatus: uploaded.parseStatus,
    assetCount: uploaded.assets.length,
    warning: uploaded.warning || null,
    expectedFallback: expectParseFailure,
  }));
} finally {
  if (manualId && cookie) {
    const deleteResponse = await fetch(`${baseUrl}/api/connector-assembly-manuals/${manualId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({ confirmText: 'DELETE_MANUAL' }),
    });
    if (!deleteResponse.ok) {
      console.error(`connector manual smoke cleanup returned HTTP ${deleteResponse.status}`);
    }
  }
}
