// Separate from business maintenance: document conversion must not delay planning/outbox work.
import { setTimeout as delay } from 'node:timers/promises';
let stopping = false;
let request;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; request?.abort(); });
while (!stopping) {
  let busy = false;
  try {
    request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 165000);
    let response;
    try { response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/internal/knowledge-preview`, {
      method: 'POST', headers: { 'x-outbox-worker-token': process.env.PROCESS_ROUTE_CHANGE_OUTBOX_WORKER_TOKEN || '' }, signal: request.signal,
    }); } finally { clearTimeout(timeout); }
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json(); busy = !!data.result?.processed;
    if (busy) console.log('[knowledge-preview]', JSON.stringify(data.result));
  } catch (error) { if (!stopping) console.warn('[knowledge-preview] worker request failed:', error.name); }
  if (!stopping) await delay(busy ? 100 : 5000);
}
