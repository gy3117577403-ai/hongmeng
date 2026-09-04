import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.env.SAMPLE_QA_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const username = process.env.SMOKE_ADMIN_USERNAME;
const initialPassword = process.env.SMOKE_ADMIN_PASSWORD;
const changedPassword = process.env.SMOKE_ADMIN_CHANGED_PASSWORD;
const expectedVersion = process.env.EXPECTED_APP_VERSION || '';
const mutationGuard = process.env.SAMPLE_QA_ALLOW_DISPOSABLE_MUTATION || '';

if (!username || !initialPassword || !changedPassword) {
  throw new Error('SMOKE_ADMIN_USERNAME, SMOKE_ADMIN_PASSWORD and SMOKE_ADMIN_CHANGED_PASSWORD are required');
}
if (!expectedVersion) {
  throw new Error('EXPECTED_APP_VERSION is required; this smoke only accepts an exact release runtime');
}
if (mutationGuard !== 'clean-ci-runtime') {
  throw new Error('SAMPLE_QA_ALLOW_DISPOSABLE_MUTATION=clean-ci-runtime is required; this smoke creates sample data');
}
const target = new URL(baseUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'sample runtime smoke is loopback-only');

let cookie = '';
const marker = `sample-${Date.now()}-${randomUUID().slice(0, 8)}`;
const candidateProcessName = `候选工序-${marker}`;
const checks = [];

function sessionCookie(response) {
  const raw = response.headers.get('set-cookie') || '';
  const match = raw.match(/hm_session=[^;]+/);
  if (!match) throw new Error('login response did not set hm_session');
  return match[0];
}

async function readBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json().catch(() => ({}));
  if (contentType.startsWith('image/')) return Buffer.from(await response.arrayBuffer());
  return response.text();
}

async function request(label, path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(method === 'GET' || method === 'HEAD' ? {} : { Origin: baseUrl }),
    ...(options.body !== undefined && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined
      ? undefined
      : options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs || 30_000),
    redirect: options.redirect || 'follow',
  });
  const body = await readBody(response);
  const expected = Array.isArray(options.expected) ? options.expected : [options.expected ?? 200];
  assert.ok(expected.includes(response.status), `${label}: HTTP ${response.status}: ${typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)}`);
  checks.push({ label, status: response.status });
  return { response, body };
}

async function login(password) {
  const result = await request('login', '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  cookie = sessionCookie(result.response);
  return result.body;
}

function processRows(milliseconds = 12_500, firstRowId = 'process-row-1') {
  return [
    {
      rowId: firstRowId,
      position: 0,
      processDefinitionId: null,
      processName: candidateProcessName,
      processOrigin: 'PROPOSED',
      stageGroup: 'backend',
      measuredMilliseconds: milliseconds,
    },
    ...Array.from({ length: 4 }, (_, index) => ({
      rowId: `process-row-${index + 2}`,
      position: index + 1,
      processDefinitionId: null,
      processName: '',
      processOrigin: 'PROPOSED',
      stageGroup: 'frontend',
      measuredMilliseconds: null,
    })),
  ];
}

function strippingRows() {
  return [{
    rowId: 'stripping-row-1',
    position: 0,
    model: 'QA-HV-01',
    outerPeelMm: '18',
    innerPeelMm: '8',
    insertionLengthMm: '12.5',
  }];
}

function photoForm({ mutationId, taskVersion, source, sortOrder }) {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+A5T0AAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.set('file', new Blob([png], { type: 'image/png' }), `${marker}-${sortOrder}.png`);
  form.set('category', sortOrder === 0 ? 'MATERIAL' : 'NOTICE');
  form.set('caption', `隔离镜像验收照片 ${sortOrder + 1}`);
  form.set('captureSource', source);
  form.set('sourceOriginalName', `${marker}-相册原图-${sortOrder + 1}.png`);
  form.set('sortOrder', String(sortOrder));
  form.set('clientMutationId', mutationId);
  form.set('expectedTaskVersion', String(taskVersion));
  return form;
}

async function run() {
  const ready = await request('readiness', '/api/ready');
  assert.equal(ready.body.service, 'hongmeng-workorder-resource');
  assert.equal(ready.body.app?.version, expectedVersion, 'runtime version mismatch');
  assert.equal(ready.body.database?.ok, true, 'disposable database is not ready');
  assert.equal(ready.body.storage?.ok, true, 'disposable object storage is not ready');

  const firstLogin = await login(initialPassword);
  assert.equal(firstLogin.mustChangePassword, true, 'sample runtime smoke requires a fresh, uninitialized seeded administrator');
  await request('change seeded admin password', '/api/auth/change-password', {
    method: 'POST',
    body: { currentPassword: initialPassword, newPassword: changedPassword, confirmPassword: changedPassword },
  });
  await login(changedPassword);

  const definitionsBefore = await request('read process library before candidate save', '/api/process-definitions');
  assert.ok(Array.isArray(definitionsBefore.body.definitions));
  assert.equal(definitionsBefore.body.definitions.some(item => item.name === candidateProcessName), false);

  const cleanBaseline = await request('verify disposable sample database is empty', '/api/sample-tasks');
  assert.ok(Array.isArray(cleanBaseline.body.tasks));
  assert.equal(cleanBaseline.body.tasks.length, 0, 'sample runtime smoke refuses to mutate a non-empty sample database');

  const created = await request('create isolated sample task', '/api/sample-tasks', {
    method: 'POST',
    expected: 201,
    body: {
      customerName: `镜像验收客户-${marker}`,
      productName: '样品采集隔离验收线束',
      specification: `T25BF2-${marker}`,
      customerLevelCode: 'A',
      dataPurpose: 'TEST',
      sampleQuantity: 5,
      planRemark: '仅用于不可变镜像运行验收，不代表正式业务数据。',
    },
  });
  let task = created.body.task;
  assert.ok(task?.id && task.qrCode && task.version === 1);

  const legacyProcess = await request('save pre-section process record for upgrade adoption', `/api/sample-tasks/${task.id}/entries`, {
    method: 'POST',
    expected: 201,
    body: {
      expectedTaskVersion: task.version,
      clientMutationId: randomUUID(),
      kind: 'PROCESS_TIME',
      label: candidateProcessName,
      payload: {
        processDefinitionId: null,
        processName: candidateProcessName,
        processOrigin: 'PROPOSED',
        recommendedSeconds: 12.5,
      },
    },
  });
  task = legacyProcess.body.task;
  const legacyProcessEntry = task.entries.find(entry => entry.kind === 'PROCESS_TIME' && entry.label === candidateProcessName);
  assert.ok(legacyProcessEntry?.id, 'pre-section process record must exist before section save');

  const processSave = await request('save five-row process draft', `/api/sample-tasks/${task.id}/sections/PROCESS_TIME`, {
    method: 'PUT',
    body: {
      expectedTaskVersion: task.version,
      expectedSectionRevision: 0,
      clientMutationId: randomUUID(),
      payload: { rows: processRows(12_500, legacyProcessEntry.id) },
      uiState: { lastEditedRowId: legacyProcessEntry.id },
    },
  });
  task = processSave.body.task;
  assert.equal(processSave.body.section.revision, 1);

  const strippingSave = await request('save stripping draft', `/api/sample-tasks/${task.id}/sections/STRIPPING`, {
    method: 'PUT',
    body: {
      expectedTaskVersion: task.version,
      expectedSectionRevision: 0,
      clientMutationId: randomUUID(),
      payload: { rows: strippingRows() },
      uiState: { lastEditedRowId: 'stripping-row-1' },
    },
  });
  task = strippingSave.body.task;

  const materialMutationId = randomUUID();
  const materialRequest = {
    expectedTaskVersion: task.version,
    clientMutationId: materialMutationId,
    kind: 'MATERIAL',
    label: '热缩管',
    payload: { name: '热缩管', specification: 'φ10 黑色', quantity: '2', unit: '段', remark: '按打印模板核对' },
  };
  const material = await request('save material specification', `/api/sample-tasks/${task.id}/entries`, {
    method: 'POST', expected: 201, body: materialRequest,
  });
  task = material.body.task;
  const replayMaterial = await request('replay material save idempotently', `/api/sample-tasks/${task.id}/entries`, {
    method: 'POST', expected: [200, 201], body: materialRequest,
  });
  task = replayMaterial.body.task;

  const notice = await request('save notice', `/api/sample-tasks/${task.id}/entries`, {
    method: 'POST', expected: 201,
    body: {
      expectedTaskVersion: task.version,
      clientMutationId: randomUUID(),
      kind: 'NOTICE',
      label: '压接检查',
      payload: { category: '质量', severity: '重要', content: '压接后拍照确认端子位置，禁止拉伤护套。' },
    },
  });
  task = notice.body.task;

  const firstPhotoMutation = randomUUID();
  const secondPhotoMutation = randomUUID();
  const photoVersion = task.version;
  const [firstPhoto, secondPhoto] = await Promise.all([
    request('upload camera photo concurrently', `/api/sample-tasks/${task.id}/photos`, {
      method: 'POST', expected: [200, 201],
      body: photoForm({ mutationId: firstPhotoMutation, taskVersion: photoVersion, source: 'CAMERA', sortOrder: 0 }),
    }),
    request('upload album photo concurrently', `/api/sample-tasks/${task.id}/photos`, {
      method: 'POST', expected: [200, 201],
      body: photoForm({ mutationId: secondPhotoMutation, taskVersion: photoVersion, source: 'ALBUM', sortOrder: 1 }),
    }),
  ]);
  assert.equal(firstPhoto.body.photoId, secondPhoto.body.photoId, 'identical photo content must resolve to one active photo');
  assert.equal([firstPhoto, secondPhoto].filter(result => result.response.status === 201).length, 1, 'only one concurrent upload may create a photo');
  assert.equal([firstPhoto, secondPhoto].filter(result => result.body.deduplicated === true).length, 1, 'the duplicate upload must be explicitly reported');

  const detailAfterPhotos = await request('reload task after concurrent photos', `/api/sample-tasks/${task.id}`);
  task = detailAfterPhotos.body.task;
  assert.equal(task.photos.length, 1);
  const savedProcessSection = task.sections.find(section => section.kind === 'PROCESS_TIME');
  assert.equal(savedProcessSection?.uiState?.lastEditedRowId, legacyProcessEntry.id);
  const storedConcurrentPhoto = task.photos.find(photo => photo.id === firstPhoto.body.photoId);
  assert.ok(storedConcurrentPhoto?.contentUrl, 'deduplicated photo must expose one content URL');
  const downloadedPhoto = await request('download deduplicated photo from object storage', storedConcurrentPhoto.contentUrl);
  assert.match(downloadedPhoto.response.headers.get('content-type') || '', /^image\/png\b/);
  assert.ok(Buffer.isBuffer(downloadedPhoto.body));
  assert.deepEqual([...downloadedPhoto.body.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const replayPhoto = await request('replay album upload idempotently', `/api/sample-tasks/${task.id}/photos`, {
    method: 'POST', expected: 200,
    body: photoForm({ mutationId: secondPhotoMutation, taskVersion: photoVersion, source: 'ALBUM', sortOrder: 1 }),
  });
  task = replayPhoto.body.task;
  assert.equal(replayPhoto.body.deduplicated, true);
  assert.equal(task.photos.length, 1);

  const deleteTarget = task.photos.find(photo => photo.id === firstPhoto.body.photoId);
  assert.ok(deleteTarget);
  const deleted = await request('soft delete draft photo', `/api/sample-photos/${deleteTarget.id}`, {
    method: 'DELETE',
    body: {
      expectedVersion: deleteTarget.version,
      expectedTaskVersion: task.version,
      deleteReason: '镜像验收照片删除路径',
    },
  });
  task = deleted.body.task;
  assert.equal(task.photos.length, 0);

  const replacementPhoto = await request('upload replacement album photo after soft delete', `/api/sample-tasks/${task.id}/photos`, {
    method: 'POST', expected: 201,
    body: photoForm({ mutationId: randomUUID(), taskVersion: task.version, source: 'ALBUM', sortOrder: 1 }),
  });
  task = replacementPhoto.body.task;
  assert.equal(replacementPhoto.body.deduplicated, false);
  assert.equal(task.photos.length, 1);
  const albumPhoto = task.photos.find(photo => photo.id === replacementPhoto.body.photoId);
  assert.ok(albumPhoto?.contentUrl, 'replacement album photo must expose a content URL');
  assert.equal(albumPhoto?.captureSource, 'ALBUM');
  assert.equal(albumPhoto?.sortOrder, 1);
  assert.equal(albumPhoto?.sourceOriginalName, `${marker}-相册原图-2.png`);

  const definitionsAfterDraft = await request('candidate save does not create process master', '/api/process-definitions');
  assert.equal(definitionsAfterDraft.body.definitions.some(item => item.name === candidateProcessName), false);

  const firstSubmitMutation = randomUUID();
  const submitVersion = task.version;
  const submitted = await request('submit immutable sample snapshot', `/api/sample-tasks/${task.id}/submit`, {
    method: 'POST',
    body: { expectedVersion: submitVersion, clientMutationId: firstSubmitMutation },
  });
  task = submitted.body.task;
  assert.equal(task.status, 'SUBMITTED');
  assert.equal(submitted.body.submission.revision, 1);
  const adoptedProcessEntries = task.entries.filter(entry => entry.kind === 'PROCESS_TIME' && entry.label === candidateProcessName);
  assert.equal(adoptedProcessEntries.length, 1, 'legacy process record must be adopted instead of duplicated');
  assert.equal(adoptedProcessEntries[0]?.id, legacyProcessEntry.id);

  const replaySubmit = await request('replay submit idempotently', `/api/sample-tasks/${task.id}/submit`, {
    method: 'POST',
    body: { expectedVersion: submitVersion, clientMutationId: firstSubmitMutation },
  });
  assert.equal(replaySubmit.body.submission.id, submitted.body.submission.id);

  await request('submitted draft is read-only', `/api/sample-tasks/${task.id}/sections/PROCESS_TIME`, {
    method: 'PUT', expected: 409,
    body: {
      expectedTaskVersion: task.version,
      expectedSectionRevision: 1,
      clientMutationId: randomUUID(),
      payload: { rows: processRows(13_000, legacyProcessEntry.id) },
      uiState: { lastEditedRowId: legacyProcessEntry.id },
    },
  });
  await request('pending submission blocks completion', `/api/sample-tasks/${task.id}`, {
    method: 'PATCH', expected: 409,
    body: { action: 'COMPLETE', expectedVersion: task.version },
  });

  const capturePage = await request('authenticated capture page renders', `/sample-capture/${encodeURIComponent(task.qrCode)}`);
  assert.ok(typeof capturePage.body === 'string' && capturePage.body.length > 500);
  const printPage = await request('authenticated standard print sheet renders', `/sample-print/${task.id}?mode=current&from=planning`);
  assert.ok(typeof printPage.body === 'string' && printPage.body.includes('样品资料采集单'));
  assert.ok(printPage.body.includes(task.code));
  assert.ok(printPage.body.includes('热缩管'));
  assert.ok(printPage.body.includes('压接后拍照确认端子位置'));
  assert.equal(printPage.body.includes(candidateProcessName), false);
  assert.match(printPage.response.headers.get('cache-control') || '', /(?:private.*no-store|no-store.*private)/i);

  const withdrawn = await request('withdraw untouched submission', `/api/sample-tasks/${task.id}/withdraw-submission`, {
    method: 'POST',
    body: { expectedVersion: task.version, clientMutationId: randomUUID(), reason: '镜像验收：继续补充工时' },
  });
  task = withdrawn.body.task;
  assert.equal(task.status, 'IN_PROGRESS');

  const editedProcess = await request('resume saved position and edit process time', `/api/sample-tasks/${task.id}/sections/PROCESS_TIME`, {
    method: 'PUT',
    body: {
      expectedTaskVersion: task.version,
      expectedSectionRevision: 1,
      clientMutationId: randomUUID(),
      payload: { rows: processRows(13_000, legacyProcessEntry.id) },
      uiState: { lastEditedRowId: legacyProcessEntry.id },
    },
  });
  task = editedProcess.body.task;
  assert.equal(editedProcess.body.section.revision, 2);

  const finalSubmit = await request('submit corrected revision', `/api/sample-tasks/${task.id}/submit`, {
    method: 'POST',
    body: { expectedVersion: task.version, clientMutationId: randomUUID() },
  });
  task = finalSubmit.body.task;
  assert.equal(task.status, 'SUBMITTED');
  assert.equal(finalSubmit.body.submission.revision, 2);

  const candidateEntryForReview = task.entries.find(entry => entry.kind === 'PROCESS_TIME' && entry.label === candidateProcessName && entry.reviewStatus === 'PENDING');
  assert.ok(candidateEntryForReview?.id, 'candidate process must be pending in revision 2');

  const confirmedPackage = await request('confirm package and auto-catalog its candidate process once', `/api/sample-tasks/${task.id}/review`, {
    method: 'POST',
    body: {
      submissionId: finalSubmit.body.submission.id,
      submissionRevision: finalSubmit.body.submission.revision,
      expectedTaskVersion: task.version,
      clientMutationId: randomUUID(),
      decision: 'CONFIRM',
      comment: '镜像验收：整包一次确认并自动收录新工序',
    },
  });
  task = confirmedPackage.body.task;
  const reviewedEntry = task.entries.find(entry => entry.id === candidateEntryForReview.id);
  assert.equal(reviewedEntry?.publishedEntityType, 'product_time_draft');
  assert.equal(reviewedEntry?.reviewStatus, 'APPROVED');
  assert.ok(reviewedEntry?.payload?.processDefinitionId, 'confirmed candidate must be bound to a process definition');
  assert.equal(reviewedEntry?.payload?.processOrigin, 'MASTER');
  assert.equal(reviewedEntry?.payload?.stageGroup, 'backend');
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.activeSubmissionId, null);
  assert.equal(task.acceptedSubmissionId, finalSubmit.body.submission.id);
  assert.equal(task.acceptedSubmission?.status, 'CONFIRMED');
  assert.ok(task.archivedAt, 'confirmed package must archive the completed task');
  assert.equal(task.counts.pendingReview, 0);
  assert.equal(task.photos.length, 1);
  assert.equal(task.photos[0]?.reviewStatus, 'PUBLISHED');

  const definitionsAfterReview = await request('package review auto-created the unknown process master', '/api/process-definitions');
  const autoCatalogedDefinition = definitionsAfterReview.body.definitions.find(item => item.name === candidateProcessName);
  assert.ok(autoCatalogedDefinition?.id, 'candidate process must be added to the process library');
  assert.equal(autoCatalogedDefinition.id, reviewedEntry.payload.processDefinitionId);
  assert.equal(autoCatalogedDefinition.stageGroup, 'backend');

  const unarchived = await request('unarchive completed task without reopening review', `/api/sample-tasks/${task.id}`, {
    method: 'PATCH',
    body: { action: 'UNARCHIVE', expectedVersion: task.version },
  });
  task = unarchived.body.task;
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.archivedAt, null);
  assert.equal(task.acceptedSubmissionId, finalSubmit.body.submission.id);
  assert.equal(task.acceptedSubmission?.status, 'CONFIRMED');
  assert.equal(task.counts.pendingReview, 0);

  const rearchived = await request('rearchive completed task without another review', `/api/sample-tasks/${task.id}`, {
    method: 'PATCH',
    body: { action: 'ARCHIVE', expectedVersion: task.version, reason: '镜像验收完成' },
  });
  task = rearchived.body.task;
  assert.ok(task.archivedAt);
  assert.equal(task.acceptedSubmissionId, finalSubmit.body.submission.id);
  assert.equal(task.counts.pendingReview, 0);

  const syncedParameters = await request('sample stripping parameter is visible with product association', `/api/connector-parameters?view=sample&keyword=${encodeURIComponent('QA-HV-01')}&pageSize=20`);
  const syncedParameter = syncedParameters.body.parameters.find(parameter => parameter.model === 'QA-HV-01');
  assert.ok(syncedParameter?.id, 'reviewed stripping parameter must enter the connector parameter library');
  assert.equal(syncedParameter.sourceType, 'SAMPLE_REVIEW');
  assert.ok(syncedParameter.productBindings.some(binding => binding.drawingLibraryItemId === task.drawingLibraryItemId && binding.isCurrent));

  const drawingItem = await request('drawing library exposes structured parameters and published photo', `/api/drawing-library/${task.drawingLibraryItemId}`);
  assert.ok(drawingItem.body.item.connectorParameters.some(binding => binding.connectorParameterId === syncedParameter.id));
  const publishedPhotoId = task.photos[0]?.id;
  const publishedDrawingFileId = task.photos[0]?.publishedFileId;
  assert.ok(publishedPhotoId && publishedDrawingFileId, 'reviewed photo must retain source and drawing-library identities');

  const displaySettings = await request('load sample photo display settings', `/api/sample-photos/${publishedPhotoId}/display-settings`);
  assert.equal(displaySettings.body.canSave, true);
  const savedDisplaySettings = await request('persist sample photo rotation', `/api/sample-photos/${publishedPhotoId}/display-settings`, {
    method: 'PATCH',
    body: { revision: displaySettings.body.revision, pageRotations: { '1': 90 } },
  });
  assert.deepEqual(savedDisplaySettings.body.pageRotations, { '1': 90 });

  const deletePreview = await request('preview completed test sample deletion', `/api/sample-tasks/${task.id}/delete`);
  assert.equal(deletePreview.body.preview.canDelete, true);
  assert.equal(deletePreview.body.preview.impact.objectDeletionCount, 0);
  const deletedTask = await request('soft delete completed test sample', `/api/sample-tasks/${task.id}/delete`, {
    method: 'DELETE',
    body: {
      reason: '不可变镜像样品删除与恢复验收',
      confirmationCode: task.code,
      previewToken: deletePreview.body.preview.previewToken,
      expectedVersion: deletePreview.body.preview.task.version,
      confirmed: true,
      clientMutationId: randomUUID(),
    },
  });
  assert.equal(deletedTask.body.recoverable, true);
  await request('deleted task source photo is no longer directly readable', `/api/sample-photos/${publishedPhotoId}/content`, { expected: 404 });
  await request('published drawing photo remains readable after task deletion', `/api/drawing-library/files/${publishedDrawingFileId}/content`);
  const trash = await request('sample trash lists deleted task', '/api/sample-tasks/trash');
  const trashed = trash.body.items.find(item => item.task.id === task.id);
  assert.ok(trashed?.task.version, 'deleted sample task must be visible in administrator trash');
  const restored = await request('restore completed sample task', `/api/sample-tasks/${task.id}/restore`, {
    method: 'POST',
    body: { reason: '不可变镜像恢复验收', confirmationCode: task.code, expectedVersion: trashed.task.version, confirmed: true },
  });
  task = restored.body.task;
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.dataPurpose, 'TEST');
  await request('restored task source photo is readable again', `/api/sample-photos/${publishedPhotoId}/content`);

  console.log(JSON.stringify({
    ok: true,
    appVersion: ready.body.app?.version || null,
    taskId: task.id,
    taskCode: task.code,
    submissionRevision: finalSubmit.body.submission.revision,
    activePhotos: task.photos.length,
    checks: checks.length,
    candidateProcessName,
  }));
}

await run();
