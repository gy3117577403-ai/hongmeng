import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchProductionBoardRange, mergeProductionBoardPage, productionBoardOffset, replaceProductionBoardExecution } from '../lib/production-board-pagination';

function page(from: number, length: number, total = 76) {
  return {
    items: Array.from({ length }, (_, index) => ({ id: `order-${from + index}`, executionKey: `order:${from + index}` })),
    pagination: { page: Math.floor(from / 60) + 1, pageSize: 60, total, totalPages: Math.ceil(total / 60) },
    summary: from === 0 ? { total } : undefined,
  };
}

test('a 60-row first page and 16-row next page preserve all 76 execution tasks', () => {
  const first = page(0, 60);
  const merged = mergeProductionBoardPage(first, page(60, 16));
  assert.equal(merged.items.length, 76);
  assert.equal(productionBoardOffset(merged), 76);
  assert.equal(merged.items[75].executionKey, 'order:75');
  assert.deepEqual(merged.summary, { total: 76 });
  assert.equal(first.items.length, 60);
});

test('continuations sharing a work-order ID retain their independent execution identities across pages', () => {
  const first = page(0, 60);
  const next = page(60, 16);
  next.items[0] = { id: first.items[59].id, executionKey: 'wip:allocation-A' };
  next.items[1] = { id: first.items[59].id, executionKey: 'wip:allocation-B' };
  const merged = mergeProductionBoardPage(first, next);
  assert.equal(merged.items.length, 76);
  assert.equal(merged.items.filter(item => item.id === 'order-59').length, 3);
});

test('overlapping server rows do not send pagination back to a previously consumed offset', () => {
  const first = page(0, 60, 150);
  const next = page(59, 60, 150);
  const merged = mergeProductionBoardPage(first, next);
  assert.equal(merged.items.length, 119);
  assert.equal(productionBoardOffset(merged), 120);
  assert.equal(new Set(merged.items.map(item => item.executionKey)).size, 119);
});

test('an ordinary order PATCH preserves same-source continuation projections until their scoped refresh', () => {
  const original = { id: 'order-1', executionKey: 'order:order-1', quantity: 100 };
  const continuation = { id: 'order-1', executionKey: 'wip:allocation-A', quantity: 20 };
  const otherContinuation = { id: 'order-1', executionKey: 'wip:allocation-B', quantity: 30 };
  const result = replaceProductionBoardExecution([original, continuation, otherContinuation], { ...original, quantity: 90 });
  assert.equal(result[0].quantity, 90);
  assert.equal(result[1], continuation);
  assert.equal(result[2], otherContinuation);
  const refreshed = mergeProductionBoardPage(
    { items: result.slice(0, 1), pagination: { page: 1, pageSize: 1, total: 3, totalPages: 3 } },
    { items: [{ ...continuation, quantity: 10 }, otherContinuation], pagination: { page: 2, pageSize: 2, total: 3, totalPages: 2 } },
  );
  assert.equal(refreshed.items[1].quantity, 10);
  assert.equal(refreshed.items.length, 3);
});

test('refresh fetches the entire previously loaded range and resolves once with its complete snapshot', async () => {
  const calls: [number, boolean][] = [];
  const result = await fetchProductionBoardRange({
    loadedOffset: 76,
    signal: new AbortController().signal,
    fetchPage: async (offset, summary) => {
      calls.push([offset, summary]);
      return page(offset, Math.min(60, 76 - offset));
    },
  });
  assert.deepEqual(calls, [[0, true], [60, false]]);
  assert.equal(result.items.length, 76);
  assert.deepEqual(result.summary, { total: 76 });
});

test('first load remains one page and refresh does not request removed rows after total shrinks', async () => {
  for (const loadedOffset of [0, 76]) {
    const calls: number[] = [];
    const result = await fetchProductionBoardRange({
      loadedOffset,
      signal: new AbortController().signal,
      fetchPage: async offset => { calls.push(offset); return page(0, 40, 40); },
    });
    assert.deepEqual(calls, [0]);
    assert.equal(result.items.length, 40);
  }
});

test('a failed continuation refresh rejects without publishing a truncated first page or retrying in a loop', async () => {
  const calls: number[] = [];
  let published = page(0, 76);
  await assert.rejects(async () => {
    published = await fetchProductionBoardRange({
      loadedOffset: 76,
      signal: new AbortController().signal,
      fetchPage: async offset => {
        calls.push(offset);
        if (offset) throw new Error('next page failed');
        return page(0, 60);
      },
    });
  }, /next page failed/);
  assert.deepEqual(calls, [0, 60]);
  assert.equal(published.items.length, 76);
});

test('filter cancellation during a delayed request prevents publishing the old range', async () => {
  const controller = new AbortController();
  let resolveNext!: (value: ReturnType<typeof page>) => void;
  const waiting = new Promise<ReturnType<typeof page>>(resolve => { resolveNext = resolve; });
  const calls: number[] = [];
  const pending = fetchProductionBoardRange({
    loadedOffset: 76,
    signal: controller.signal,
    fetchPage: async offset => {
      calls.push(offset);
      return offset ? waiting : page(0, 60);
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  resolveNext(page(60, 16));
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(calls, [0, 60]);
});

test('an empty page claiming more rows stops with a recoverable error instead of refetching forever', async () => {
  let calls = 0;
  await assert.rejects(fetchProductionBoardRange({
    loadedOffset: 76,
    signal: new AbortController().signal,
    fetchPage: async offset => { calls += 1; return offset ? page(offset, 0) : page(0, 60); },
  }), /下一页未返回工单/);
  assert.equal(calls, 2);
});
