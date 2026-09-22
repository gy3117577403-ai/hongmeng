export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { processFixtureSyncQueue } = await import("./lib/quality-fixture-sync");
  const { processDrawingReplacementJobs } = await import("./lib/drawing-replacement");
  const state = globalThis as typeof globalThis & { fixtureSyncTimer?: ReturnType<typeof setTimeout> };
  if (state.fixtureSyncTimer) return;
  const tick = async () => {
    let pending = false;
    try { pending = (await processDrawingReplacementJobs()).pending; }
    catch (error) { console.error('[drawing-replacement-worker]', error instanceof Error ? error.message : 'Retry failed'); }
    try { pending = (await processFixtureSyncQueue()).pending || pending; }
    catch (error) { console.error("[document-review-sync]", error instanceof Error ? error.message : "Sync failed"); }
    state.fixtureSyncTimer = setTimeout(tick, pending ? 500 : 15000);
    state.fixtureSyncTimer.unref();
  };
  state.fixtureSyncTimer = setTimeout(tick, 2000);
  state.fixtureSyncTimer.unref();
}
}

