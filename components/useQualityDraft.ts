'use client';
import { useEffect, useState } from 'react';
const PREFIX = 'hm-quality-draft:';
const MAX_AGE = 12 * 60 * 60 * 1000;
/** Tab-local, account/event/round-scoped text only. Files stay in the upload queue/S3. */
export function useQualityDraft<T>(key: string, source: T) {
  const encoded = JSON.stringify(source);
  const [value, setValue] = useState<T>(source);
  const [baseline, setBaseline] = useState(encoded);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    let next = source, base = encoded;
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      if (raw) { const saved = JSON.parse(raw); if (Date.now() - saved.at < MAX_AGE && saved.value && typeof saved.baseline === 'string') { next = saved.value; base = saved.baseline; } else sessionStorage.removeItem(PREFIX + key); }
    } catch { setStorageAvailable(false); }
    setValue(next); setBaseline(base); setReady(true);
    // The owner remounts when account/event/round changes; never reinitialize on a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const dirty = JSON.stringify(value) !== baseline;
  const conflict = dirty && encoded !== baseline;
  useEffect(() => {
    if (!ready) return;
    if (!dirty && encoded !== baseline) { setValue(source); setBaseline(encoded); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoded, ready]);
  useEffect(() => {
    if (!ready) return;
    try { if (dirty) sessionStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value, baseline })); else sessionStorage.removeItem(PREFIX + key); }
    catch { setStorageAvailable(false); }
  }, [key, value, baseline, dirty, ready]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  return { value, setValue, dirty, conflict, ready, storageAvailable,
    saved: (submitted: T) => { setBaseline(JSON.stringify(submitted)); },
    useServer: () => { setValue(source); setBaseline(encoded); },
    keepDraft: () => setBaseline(encoded),
  };
}
