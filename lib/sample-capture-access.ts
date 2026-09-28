import type { ModuleAccessCarrier } from '@/lib/module-permissions';

/** This independent grant covers capture only, never planning, review or publishing. */
export function independentSampleCaptureRoute(access: ModuleAccessCarrier, pathname: string, method = 'GET'): boolean {
  if (!access.sampleCaptureEnabled) return false;
  const path = pathname.split('?')[0].replace(/\/+$/, '');
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return path === '/api/sample-team/context'
    || /^\/api\/sample-tasks\/code\/[^/]+$/.test(path)
    || /^\/api\/sample-tasks\/[^/]+\/sections$/.test(path)
    || /^\/api\/sample-photos\/[^/]+\/content$/.test(path);
  if (verb === 'POST') return /^\/api\/sample-tasks\/[^/]+\/(entries|photos|submit|withdraw-submission)$/.test(path);
  if (verb === 'PUT') return /^\/api\/sample-tasks\/[^/]+\/sections\/(PROCESS_TIME|STRIPPING)$/.test(path);
  if (verb === 'PATCH' || verb === 'DELETE') return /^\/api\/sample-(entries|photos)\/[^/]+$/.test(path);
  return false;
}

export function sampleCaptureDraftKeys(userId: string, code: string) {
  const prefix = `sample-capture:user:${encodeURIComponent(userId)}:task:${encodeURIComponent(code)}`;
  return { generic: `${prefix}:draft`, sections: `${prefix}:sections-v2`, photos: `${prefix}:photo-queue-v2`, submission: `${prefix}:submission-mutation`, withdrawal: `${prefix}:withdraw-mutation` };
}
