export const AUTO_FIRST_PAGE_STEP_CAPACITY = 22;
export const AUTO_CONTINUATION_STEP_CAPACITY = 26;
export const MAX_CUSTOM_TRAVELER_PAGES = 12;
export const MAX_TRAVELER_PAGES = 50;

export type TravelerLayoutMode = 'auto' | 'single' | 'double' | 'custom';

export type TravelerLayoutSelection = {
  mode: TravelerLayoutMode;
  customPageCount?: number;
};

export type TravelerPageChunk<T> = {
  pageNumber: number;
  pageCount: number;
  startIndex: number;
  endIndexExclusive: number;
  steps: T[];
};

export type TravelerPageManifestPage = {
  pageNumber: number;
  startIndex: number;
  endIndexExclusive: number;
  stepCount: number;
};

export type TravelerPageManifest = {
  version: 1;
  mode: TravelerLayoutMode;
  requestedPageCount: number;
  expectedStepCount: number;
  pageCount: number;
  pages: TravelerPageManifestPage[];
};

function integerInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeTravelerLayoutSelection(
  selection: TravelerLayoutSelection,
): Required<TravelerLayoutSelection> {
  const mode: TravelerLayoutMode = selection.mode === 'single'
    || selection.mode === 'double'
    || selection.mode === 'custom'
    ? selection.mode
    : 'auto';
  return {
    mode,
    customPageCount: integerInRange(
      selection.customPageCount,
      3,
      1,
      MAX_CUSTOM_TRAVELER_PAGES,
    ),
  };
}

export function travelerPageCountForSteps(
  stepCountInput: number,
  selectionInput: TravelerLayoutSelection,
): number {
  const stepCount = Math.max(0, Math.floor(stepCountInput));
  if (!stepCount) return 0;
  const selection = normalizeTravelerLayoutSelection(selectionInput);
  let requestedPageCount = 1;
  if (selection.mode === 'double') requestedPageCount = 2;
  if (selection.mode === 'custom') requestedPageCount = selection.customPageCount;
  if (selection.mode === 'auto' && stepCount > AUTO_FIRST_PAGE_STEP_CAPACITY) {
    requestedPageCount = 1 + Math.ceil(
      (stepCount - AUTO_FIRST_PAGE_STEP_CAPACITY) / AUTO_CONTINUATION_STEP_CAPACITY,
    );
  }
  return Math.max(1, Math.min(stepCount, MAX_TRAVELER_PAGES, requestedPageCount));
}

export function paginateTravelerSteps<T>(
  stepsInput: readonly T[],
  selectionInput: TravelerLayoutSelection,
): TravelerPageChunk<T>[] {
  const steps = [...stepsInput];
  const pageCount = travelerPageCountForSteps(steps.length, selectionInput);
  if (!pageCount) return [];
  if (pageCount === 1) {
    return [{
      pageNumber: 1,
      pageCount: 1,
      startIndex: 0,
      endIndexExclusive: steps.length,
      steps,
    }];
  }

  const pages: TravelerPageChunk<T>[] = [];
  let cursor = 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const remainingSteps = steps.length - cursor;
    const remainingPages = pageCount - pageIndex;
    let take = Math.ceil(remainingSteps / remainingPages);
    // The first sheet carries the full product/QR header, so give continuation
    // sheets one extra row when an even split is otherwise possible.
    if (pageIndex === 0 && take > 1) take -= 1;
    take = Math.max(1, Math.min(take, remainingSteps - (remainingPages - 1)));
    const startIndex = cursor;
    const endIndexExclusive = cursor + take;
    pages.push({
      pageNumber: pageIndex + 1,
      pageCount,
      startIndex,
      endIndexExclusive,
      steps: steps.slice(startIndex, endIndexExclusive),
    });
    cursor = endIndexExclusive;
  }
  return pages;
}

export function createTravelerPageManifest<T>(
  expectedStepCount: number,
  pages: readonly TravelerPageChunk<T>[],
  selectionInput: TravelerLayoutSelection,
): TravelerPageManifest {
  const selection = normalizeTravelerLayoutSelection(selectionInput);
  return {
    version: 1,
    mode: selection.mode,
    requestedPageCount: selection.mode === 'single'
      ? 1
      : selection.mode === 'double'
        ? 2
        : selection.mode === 'custom'
          ? selection.customPageCount
          : pages.length,
    expectedStepCount,
    pageCount: pages.length,
    pages: pages.map(page => ({
      pageNumber: page.pageNumber,
      startIndex: page.startIndex,
      endIndexExclusive: page.endIndexExclusive,
      stepCount: page.steps.length,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label}格式无效`);
  }
  return value;
}

export function validateTravelerPageManifest(
  input: unknown,
  expectedStepCount: number,
): TravelerPageManifest {
  if (!isRecord(input) || input.version !== 1) throw new Error('流转单分页清单版本无效');
  if (input.mode !== 'auto' && input.mode !== 'single' && input.mode !== 'double' && input.mode !== 'custom') {
    throw new Error('流转单分页方式无效');
  }
  const manifestExpected = requiredInteger(input.expectedStepCount, '流转单工序总数', 1, 10000);
  if (manifestExpected !== expectedStepCount) {
    throw new Error(`流转单工序总数不一致：应有 ${expectedStepCount} 道，当前为 ${manifestExpected} 道`);
  }
  const requestedPageCount = requiredInteger(
    input.requestedPageCount,
    '流转单请求页数',
    1,
    input.mode === 'custom' ? MAX_CUSTOM_TRAVELER_PAGES : MAX_TRAVELER_PAGES,
  );
  const pageCount = requiredInteger(input.pageCount, '流转单页数', 1, MAX_TRAVELER_PAGES);
  if (!Array.isArray(input.pages) || input.pages.length !== pageCount) {
    throw new Error(`流转单分页不完整：应有 ${pageCount} 页，当前为 ${Array.isArray(input.pages) ? input.pages.length : 0} 页`);
  }
  const expectedPageCount = travelerPageCountForSteps(expectedStepCount, {
    mode: input.mode,
    customPageCount: requestedPageCount,
  });
  if (expectedPageCount !== pageCount) {
    throw new Error(`流转单页数与分页方式不一致：应为 ${expectedPageCount} 页，当前为 ${pageCount} 页`);
  }

  let cursor = 0;
  const pages = input.pages.map((pageInput, index): TravelerPageManifestPage => {
    if (!isRecord(pageInput)) throw new Error(`流转单第 ${index + 1} 页清单无效`);
    const pageNumber = requiredInteger(pageInput.pageNumber, `流转单第 ${index + 1} 页页码`, 1, pageCount);
    const startIndex = requiredInteger(pageInput.startIndex, `流转单第 ${index + 1} 页起始工序`, 0, expectedStepCount - 1);
    const endIndexExclusive = requiredInteger(pageInput.endIndexExclusive, `流转单第 ${index + 1} 页结束工序`, 1, expectedStepCount);
    const stepCount = requiredInteger(pageInput.stepCount, `流转单第 ${index + 1} 页工序数`, 1, expectedStepCount);
    if (pageNumber !== index + 1 || startIndex !== cursor || endIndexExclusive <= startIndex) {
      throw new Error(`流转单第 ${index + 1} 页工序范围不连续`);
    }
    if (stepCount !== endIndexExclusive - startIndex) {
      throw new Error(`流转单第 ${index + 1} 页工序数量不一致`);
    }
    cursor = endIndexExclusive;
    return { pageNumber, startIndex, endIndexExclusive, stepCount };
  });
  if (cursor !== expectedStepCount) {
    throw new Error(`流转单生成不完整：应有 ${expectedStepCount} 道工序，当前只覆盖 ${cursor} 道`);
  }
  return {
    version: 1,
    mode: input.mode,
    requestedPageCount,
    expectedStepCount,
    pageCount,
    pages,
  };
}
