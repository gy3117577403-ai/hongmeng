export type ClientFetchErrorDetails = {
  status?: number;
  code?: string;
  requestId?: string;
  retryable?: boolean;
};

export class ClientFetchError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(message: string, details: ClientFetchErrorDetails = {}) {
    super(message);
    this.name = 'ClientFetchError';
    this.status = details.status;
    this.code = details.code;
    this.requestId = details.requestId;
    this.retryable = details.retryable === true;
  }
}

type ErrorPayload = {
  error?: unknown;
  code?: unknown;
  requestId?: unknown;
};

export type FetchJsonOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);

function abortReason(signal: AbortSignal): unknown {
  return signal.reason || new DOMException('请求已取消', 'AbortError');
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return;
  }
  if (signal.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchJson<T>(input: RequestInfo | URL, options: FetchJsonOptions = {}): Promise<T> {
  const {
    timeoutMs = 10_000,
    retries = 0,
    signal: callerSignal,
    ...requestInit
  } = options;
  const method = String(requestInit.method || 'GET').toUpperCase();
  const maxRetries = method === 'GET' || method === 'HEAD' ? Math.max(0, retries) : 0;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(abortReason(callerSignal!));
    if (callerSignal?.aborted) controller.abort(abortReason(callerSignal));
    else callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeoutMs);
    try {
      const response = await fetch(input, { ...requestInit, signal: controller.signal });
      const payload = await response.json().catch(() => ({})) as T & ErrorPayload;
      if (response.ok) return payload;
      const retryable = RETRYABLE_STATUS.has(response.status);
      const error = new ClientFetchError(
        typeof payload.error === 'string' ? payload.error : `请求失败（HTTP ${response.status}）`,
        {
          status: response.status,
          code: typeof payload.code === 'string' ? payload.code : undefined,
          requestId: typeof payload.requestId === 'string'
            ? payload.requestId
            : response.headers.get('X-Request-Id') || undefined,
          retryable,
        },
      );
      if (!retryable || attempt >= maxRetries) throw error;
    } catch (error) {
      if (callerSignal?.aborted) throw abortReason(callerSignal);
      const timedOut = controller.signal.aborted;
      const retryable = timedOut || error instanceof TypeError || (error instanceof ClientFetchError && error.retryable);
      if (!retryable || attempt >= maxRetries) {
        if (error instanceof ClientFetchError) throw error;
        throw new ClientFetchError(timedOut ? '请求超时，请重试' : '网络连接失败，请重试', { retryable });
      }
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
    await waitForRetry(300 * (attempt + 1), callerSignal || undefined);
  }
}
