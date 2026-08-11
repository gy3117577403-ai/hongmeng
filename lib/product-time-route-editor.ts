export type ProductTimeRouteEntry = {
  occurrenceKey: string;
  parallelWithPrevious: boolean;
};

export type ProductTimeRouteGroup<T extends ProductTimeRouteEntry> = {
  key: string;
  startIndex: number;
  endIndex: number;
  entries: T[];
};

export function productTimeRouteGroups<T extends ProductTimeRouteEntry>(
  entries: readonly T[],
): ProductTimeRouteGroup<T>[] {
  const groups: ProductTimeRouteGroup<T>[] = [];

  entries.forEach((entry, index) => {
    const current = groups[groups.length - 1];
    if (current && entry.parallelWithPrevious) {
      current.entries.push(entry);
      current.endIndex = index;
      return;
    }
    groups.push({
      key: entry.occurrenceKey,
      startIndex: index,
      endIndex: index,
      entries: [entry],
    });
  });

  return groups;
}

function flattenGroups<T extends ProductTimeRouteEntry>(
  groups: readonly ProductTimeRouteGroup<T>[],
): T[] {
  return groups.flatMap(group => group.entries.map((entry, index) => ({
    ...entry,
    parallelWithPrevious: index > 0,
  })));
}

export function groupKeyForProductTimeEntry<T extends ProductTimeRouteEntry>(
  entries: readonly T[],
  occurrenceKey: string,
): string | null {
  return productTimeRouteGroups(entries)
    .find(group => group.entries.some(entry => entry.occurrenceKey === occurrenceKey))
    ?.key || null;
}

export function insertProductTimeRouteEntry<T extends ProductTimeRouteEntry>(
  entries: readonly T[],
  entry: T,
  beforeGroupKey: string | null,
  parallelWithPrevious = false,
): T[] {
  const groups = productTimeRouteGroups(entries);
  const targetGroup = beforeGroupKey
    ? groups.find(group => group.key === beforeGroupKey)
    : null;
  const insertionIndex = targetGroup?.startIndex ?? entries.length;
  const next = [...entries];
  next.splice(insertionIndex, 0, {
    ...entry,
    parallelWithPrevious: insertionIndex > 0 && parallelWithPrevious,
  });
  return next;
}

export function moveProductTimeRouteGroupBefore<T extends ProductTimeRouteEntry>(
  entries: readonly T[],
  activeOccurrenceKey: string,
  beforeGroupKey: string | null,
): T[] {
  const groups = productTimeRouteGroups(entries);
  const activeIndex = groups.findIndex(group => group.entries.some(
    entry => entry.occurrenceKey === activeOccurrenceKey,
  ));
  if (activeIndex < 0) return [...entries];

  const activeGroup = groups[activeIndex];
  if (beforeGroupKey && activeGroup.key === beforeGroupKey) return [...entries];

  const remaining = groups.filter((_group, index) => index !== activeIndex);
  const targetIndex = beforeGroupKey
    ? remaining.findIndex(group => group.key === beforeGroupKey)
    : remaining.length;
  if (beforeGroupKey && targetIndex < 0) return [...entries];

  remaining.splice(targetIndex, 0, activeGroup);
  return flattenGroups(remaining);
}

export function reorderProductTimeRouteGroup<T extends ProductTimeRouteEntry>(
  entries: readonly T[],
  activeOccurrenceKey: string,
  overOccurrenceKey: string,
): T[] {
  const groups = productTimeRouteGroups(entries);
  const activeIndex = groups.findIndex(group => group.entries.some(
    entry => entry.occurrenceKey === activeOccurrenceKey,
  ));
  const overIndex = groups.findIndex(group => group.entries.some(
    entry => entry.occurrenceKey === overOccurrenceKey,
  ));
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return [...entries];

  const next = [...groups];
  const [activeGroup] = next.splice(activeIndex, 1);
  next.splice(overIndex, 0, activeGroup);
  return flattenGroups(next);
}

export function moveProductTimeRouteGroupByDirection<T extends ProductTimeRouteEntry>(
  entries: readonly T[],
  occurrenceKey: string,
  direction: -1 | 1,
): T[] {
  const groups = productTimeRouteGroups(entries);
  const activeIndex = groups.findIndex(group => group.entries.some(
    entry => entry.occurrenceKey === occurrenceKey,
  ));
  const targetIndex = activeIndex + direction;
  if (activeIndex < 0 || targetIndex < 0 || targetIndex >= groups.length) return [...entries];

  const next = [...groups];
  const [activeGroup] = next.splice(activeIndex, 1);
  next.splice(targetIndex, 0, activeGroup);
  return flattenGroups(next);
}

export function removeProductTimeRouteEntry<T extends ProductTimeRouteEntry>(
  entries: readonly T[],
  occurrenceKey: string,
): T[] {
  const index = entries.findIndex(entry => entry.occurrenceKey === occurrenceKey);
  if (index < 0) return [...entries];

  const removedWasGroupStart = index === 0 || !entries[index].parallelWithPrevious;
  const next = entries.filter(entry => entry.occurrenceKey !== occurrenceKey).map(entry => ({ ...entry }));
  if (removedWasGroupStart && next[index]?.parallelWithPrevious) {
    next[index] = { ...next[index], parallelWithPrevious: false };
  }
  if (next[0]?.parallelWithPrevious) next[0] = { ...next[0], parallelWithPrevious: false };
  return next;
}
