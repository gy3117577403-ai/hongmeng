type ExecutionItem = { id: string; executionKey: string };

export type ProductionBoardPage = {
  items: ExecutionItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; loadedOffset?: number; snapshotToken?: string | null };
};

/** Offset counts server rows, including duplicates caused by changes between page requests. */
export function productionBoardOffset(board: ProductionBoardPage): number {
  return board.pagination.loadedOffset ?? board.items.length;
}

/** An ordinary order PATCH cannot replace independent WIP allocations of that order. */
export function replaceProductionBoardExecution<T extends ExecutionItem>(items: T[], updated: T): T[] {
  return items.map(item => item.executionKey === updated.executionKey ? updated : item);
}

export function mergeProductionBoardPage<T extends ProductionBoardPage>(current: T, next: T): T {
  const offset = productionBoardOffset(current);
  if (current.pagination.snapshotToken && next.pagination.snapshotToken !== current.pagination.snapshotToken) {
    throw new Error('查询结果已变化，请刷新生产看板');
  }
  const nextOffset = next.pagination.loadedOffset ?? offset + next.items.length;
  if (nextOffset <= offset && offset < next.pagination.total) {
    throw new Error('下一页未返回工单，请重试加载');
  }
  const items = [...current.items];
  const indexes = new Map(items.map((item, index) => [item.executionKey, index]));
  for (const item of next.items) {
    const index = indexes.get(item.executionKey);
    if (index === undefined) {
      indexes.set(item.executionKey, items.length);
      items.push(item);
    } else {
      items[index] = item;
    }
  }
  return {
    ...current,
    items,
    pagination: { ...next.pagination, page: 1, loadedOffset: nextOffset },
  };
}

/** Keep the previous snapshot visible until its entire loaded range has refreshed. */
export async function fetchProductionBoardRange<T extends ProductionBoardPage>(input: {
  fetchPage: (offset: number, includeSummary: boolean, snapshotToken?: string | null) => Promise<T>;
  loadedOffset: number;
  signal: AbortSignal;
}): Promise<T> {
  const assertActive = (): void => {
    if (input.signal.aborted) throw input.signal.reason || new DOMException('请求已取消', 'AbortError');
  };
  assertActive();
  const first = await input.fetchPage(0, true);
  assertActive();
  let board: T = { ...first, pagination: { ...first.pagination, loadedOffset: first.pagination.loadedOffset ?? first.items.length } };
  const targetOffset = Math.max(first.items.length, input.loadedOffset);
  while (productionBoardOffset(board) < Math.min(targetOffset, board.pagination.total)) {
    const next = await input.fetchPage(productionBoardOffset(board), false, board.pagination.snapshotToken);
    assertActive();
    board = mergeProductionBoardPage(board, next);
  }
  return board;
}
