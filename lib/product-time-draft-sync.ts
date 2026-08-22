export type ProductTimeDraftMergeEntry = {
  processDefinitionId: string;
  occurrenceKey: string;
  position: number;
  sequenceGroup: number;
  timeBasis: string;
  unitMilliseconds: number;
  actionMilliseconds: number | null;
  occurrences: number;
  setupMilliseconds: number;
  unitLabel: string;
  reportQuantityBasis: string;
  reportUnitLabel: string;
  countsForEfficiency: boolean;
  isCritical: boolean;
  remark: string | null;
};

export type ProductTimeDraftSyncConflict = {
  kind: 'FIELDS_CHANGED_ON_BOTH_SIDES' | 'PUBLISHED_DELETED_DRAFT_CHANGED' | 'DRAFT_DELETED_PUBLISHED_CHANGED' | 'STRUCTURE_CHANGED_ON_BOTH_SIDES';
  occurrenceKey: string | null;
  processDefinitionId: string | null;
  fields: string[];
  resolution: 'draft_preserved' | 'published_restored';
};

export type ProductTimeDraftMergeSummary = {
  addedFromPublished: number;
  updatedFromPublished: number;
  removedFromPublished: number;
  preservedDraftChanges: number;
  conflicts: ProductTimeDraftSyncConflict[];
};

export type ProductTimeDraftMergeResult = {
  entries: ProductTimeDraftMergeEntry[];
  summary: ProductTimeDraftMergeSummary;
};

const VALUE_FIELDS = [
  'processDefinitionId',
  'timeBasis',
  'unitMilliseconds',
  'actionMilliseconds',
  'occurrences',
  'setupMilliseconds',
  'unitLabel',
  'reportQuantityBasis',
  'reportUnitLabel',
  'countsForEfficiency',
  'isCritical',
  'remark',
] as const satisfies ReadonlyArray<keyof ProductTimeDraftMergeEntry>;

type ValueField = typeof VALUE_FIELDS[number];

function ordered(entries: ProductTimeDraftMergeEntry[]): ProductTimeDraftMergeEntry[] {
  return [...entries].sort((left, right) => left.position - right.position || left.occurrenceKey.localeCompare(right.occurrenceKey));
}

function sameField(
  left: ProductTimeDraftMergeEntry,
  right: ProductTimeDraftMergeEntry,
  field: ValueField,
): boolean {
  return left[field] === right[field];
}

function changedValueFields(
  left: ProductTimeDraftMergeEntry,
  right: ProductTimeDraftMergeEntry,
): ValueField[] {
  return VALUE_FIELDS.filter(field => !sameField(left, right, field));
}

function sameValues(left: ProductTimeDraftMergeEntry, right: ProductTimeDraftMergeEntry): boolean {
  return changedValueFields(left, right).length === 0;
}

function structureState(entries: ProductTimeDraftMergeEntry[]) {
  const list = ordered(entries);
  const state = new Map<string, { previousOccurrenceKey: string | null; parallelWithPrevious: boolean }>();
  list.forEach((entry, index) => {
    const previous = list[index - 1] || null;
    state.set(entry.occurrenceKey, {
      previousOccurrenceKey: previous?.occurrenceKey || null,
      parallelWithPrevious: Boolean(previous && previous.sequenceGroup === entry.sequenceGroup),
    });
  });
  return state;
}

function sameStructureForKey(
  occurrenceKey: string,
  left: Map<string, { previousOccurrenceKey: string | null; parallelWithPrevious: boolean }>,
  right: Map<string, { previousOccurrenceKey: string | null; parallelWithPrevious: boolean }>,
): boolean {
  const leftState = left.get(occurrenceKey);
  const rightState = right.get(occurrenceKey);
  return Boolean(
    leftState
      && rightState
      && leftState.previousOccurrenceKey === rightState.previousOccurrenceKey
      && leftState.parallelWithPrevious === rightState.parallelWithPrevious,
  );
}

function filteredStructureSignature(entries: ProductTimeDraftMergeEntry[], allowed: Set<string>): string {
  const list = ordered(entries).filter(entry => allowed.has(entry.occurrenceKey));
  return JSON.stringify(list.map((entry, index) => ({
    occurrenceKey: entry.occurrenceKey,
    parallelWithPrevious: index > 0 && list[index - 1].sequenceGroup === entry.sequenceGroup,
  })));
}

function adjacentParallel(
  entries: ProductTimeDraftMergeEntry[],
  previousKey: string,
  currentKey: string,
): boolean | null {
  const list = ordered(entries);
  const currentIndex = list.findIndex(entry => entry.occurrenceKey === currentKey);
  if (currentIndex <= 0 || list[currentIndex - 1].occurrenceKey !== previousKey) return null;
  return list[currentIndex - 1].sequenceGroup === list[currentIndex].sequenceGroup;
}

function insertMissingKeys(
  target: string[],
  sourceEntries: ProductTimeDraftMergeEntry[],
  selectedKeys: Set<string>,
): string[] {
  const source = ordered(sourceEntries)
    .map(entry => entry.occurrenceKey)
    .filter(key => selectedKeys.has(key));
  const result = [...target];
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const key = source[sourceIndex];
    if (result.includes(key)) continue;
    let inserted = false;
    for (let previousIndex = sourceIndex - 1; previousIndex >= 0; previousIndex -= 1) {
      const anchorIndex = result.indexOf(source[previousIndex]);
      if (anchorIndex < 0) continue;
      result.splice(anchorIndex + 1, 0, key);
      inserted = true;
      break;
    }
    if (inserted) continue;
    for (let nextIndex = sourceIndex + 1; nextIndex < source.length; nextIndex += 1) {
      const anchorIndex = result.indexOf(source[nextIndex]);
      if (anchorIndex < 0) continue;
      result.splice(anchorIndex, 0, key);
      inserted = true;
      break;
    }
    if (!inserted) result.push(key);
  }
  return result;
}

/**
 * Three-way merge for a product-time draft.
 *
 * The archived profile that the draft originally followed is the base. The
 * current draft and latest published profile are merged by occurrenceKey. A
 * draft-side edit wins only when both sides changed the same value; the
 * conflict is returned explicitly so the operator can review it before
 * publishing. Published-only additions are always brought into the draft.
 */
export function mergeProductTimeDraftWithPublished(input: {
  baseEntries: ProductTimeDraftMergeEntry[];
  draftEntries: ProductTimeDraftMergeEntry[];
  publishedEntries: ProductTimeDraftMergeEntry[];
}): ProductTimeDraftMergeResult {
  const baseEntries = ordered(input.baseEntries);
  const draftEntries = ordered(input.draftEntries);
  const publishedEntries = ordered(input.publishedEntries);
  const baseByKey = new Map(baseEntries.map(entry => [entry.occurrenceKey, entry]));
  const draftByKey = new Map(draftEntries.map(entry => [entry.occurrenceKey, entry]));
  const publishedByKey = new Map(publishedEntries.map(entry => [entry.occurrenceKey, entry]));
  const baseStructure = structureState(baseEntries);
  const draftStructure = structureState(draftEntries);
  const publishedStructure = structureState(publishedEntries);
  const selected = new Map<string, ProductTimeDraftMergeEntry>();
  const conflicts: ProductTimeDraftSyncConflict[] = [];
  let addedFromPublished = 0;
  let updatedFromPublished = 0;
  let removedFromPublished = 0;

  const allKeys = new Set([
    ...baseByKey.keys(),
    ...draftByKey.keys(),
    ...publishedByKey.keys(),
  ]);

  for (const occurrenceKey of allKeys) {
    const base = baseByKey.get(occurrenceKey) || null;
    const draft = draftByKey.get(occurrenceKey) || null;
    const published = publishedByKey.get(occurrenceKey) || null;

    if (!base) {
      if (draft && published) {
        if (!sameValues(draft, published)) {
          conflicts.push({
            kind: 'FIELDS_CHANGED_ON_BOTH_SIDES',
            occurrenceKey,
            processDefinitionId: draft.processDefinitionId,
            fields: changedValueFields(draft, published),
            resolution: 'draft_preserved',
          });
        }
        selected.set(occurrenceKey, { ...draft });
      } else if (draft) {
        selected.set(occurrenceKey, { ...draft });
      } else if (published) {
        selected.set(occurrenceKey, { ...published });
        addedFromPublished += 1;
      }
      continue;
    }

    if (draft && published) {
      const merged = { ...draft };
      const conflictingFields: string[] = [];
      let adoptedPublishedField = false;
      for (const field of VALUE_FIELDS) {
        const draftChanged = !sameField(draft, base, field);
        const publishedChanged = !sameField(published, base, field);
        if (!draftChanged && publishedChanged) {
          (merged[field] as ProductTimeDraftMergeEntry[ValueField]) = published[field];
          adoptedPublishedField = true;
        } else if (draftChanged && publishedChanged && !sameField(draft, published, field)) {
          conflictingFields.push(field);
        }
      }
      if (adoptedPublishedField) updatedFromPublished += 1;
      if (conflictingFields.length) {
        conflicts.push({
          kind: 'FIELDS_CHANGED_ON_BOTH_SIDES',
          occurrenceKey,
          processDefinitionId: draft.processDefinitionId,
          fields: conflictingFields,
          resolution: 'draft_preserved',
        });
      }
      selected.set(occurrenceKey, merged);
      continue;
    }

    if (draft && !published) {
      const draftChanged = !sameValues(draft, base)
        || !sameStructureForKey(occurrenceKey, draftStructure, baseStructure);
      if (draftChanged) {
        selected.set(occurrenceKey, { ...draft });
        conflicts.push({
          kind: 'PUBLISHED_DELETED_DRAFT_CHANGED',
          occurrenceKey,
          processDefinitionId: draft.processDefinitionId,
          fields: ['publishedDeletion'],
          resolution: 'draft_preserved',
        });
      } else {
        removedFromPublished += 1;
      }
      continue;
    }

    if (!draft && published) {
      const publishedChanged = !sameValues(published, base)
        || !sameStructureForKey(occurrenceKey, publishedStructure, baseStructure);
      if (publishedChanged) {
        selected.set(occurrenceKey, { ...published });
        conflicts.push({
          kind: 'DRAFT_DELETED_PUBLISHED_CHANGED',
          occurrenceKey,
          processDefinitionId: published.processDefinitionId,
          fields: ['draftDeletion'],
          resolution: 'published_restored',
        });
        updatedFromPublished += 1;
      }
    }
  }

  const commonBaseKeys = new Set(
    [...baseByKey.keys()].filter(key => draftByKey.has(key) && publishedByKey.has(key) && selected.has(key)),
  );
  const baseCommonSignature = filteredStructureSignature(baseEntries, commonBaseKeys);
  const draftCommonSignature = filteredStructureSignature(draftEntries, commonBaseKeys);
  const publishedCommonSignature = filteredStructureSignature(publishedEntries, commonBaseKeys);
  const draftStructureChanged = draftCommonSignature !== baseCommonSignature;
  const publishedStructureChanged = publishedCommonSignature !== baseCommonSignature;
  const usePublishedBackbone = !draftStructureChanged && publishedStructureChanged;
  if (
    draftStructureChanged
    && publishedStructureChanged
    && draftCommonSignature !== publishedCommonSignature
  ) {
    conflicts.push({
      kind: 'STRUCTURE_CHANGED_ON_BOTH_SIDES',
      occurrenceKey: null,
      processDefinitionId: null,
      fields: ['position', 'sequenceGroup'],
      resolution: 'draft_preserved',
    });
  }

  const selectedKeys = new Set(selected.keys());
  const primaryEntries = usePublishedBackbone ? publishedEntries : draftEntries;
  const secondaryEntries = usePublishedBackbone ? draftEntries : publishedEntries;
  let orderedKeys = ordered(primaryEntries)
    .map(entry => entry.occurrenceKey)
    .filter(key => selectedKeys.has(key));
  orderedKeys = insertMissingKeys(orderedKeys, secondaryEntries, selectedKeys);
  orderedKeys = insertMissingKeys(orderedKeys, baseEntries, selectedKeys);

  let sequenceGroup = 0;
  const mergedEntries = orderedKeys.map((occurrenceKey, index) => {
    const previousKey = orderedKeys[index - 1] || null;
    const primaryParallel = previousKey
      ? adjacentParallel(primaryEntries, previousKey, occurrenceKey)
      : false;
    const secondaryParallel = previousKey
      ? adjacentParallel(secondaryEntries, previousKey, occurrenceKey)
      : false;
    const parallelWithPrevious = index > 0
      && (primaryParallel ?? secondaryParallel ?? false);
    if (!parallelWithPrevious) sequenceGroup += 1;
    return {
      ...selected.get(occurrenceKey)!,
      position: index + 1,
      sequenceGroup,
    };
  });

  const draftChangedKeys = new Set<string>();
  for (const occurrenceKey of new Set([...baseByKey.keys(), ...draftByKey.keys()])) {
    const base = baseByKey.get(occurrenceKey) || null;
    const draft = draftByKey.get(occurrenceKey) || null;
    if (!base || !draft) {
      draftChangedKeys.add(occurrenceKey);
      continue;
    }
    if (
      !sameValues(base, draft)
      || !sameStructureForKey(occurrenceKey, baseStructure, draftStructure)
    ) draftChangedKeys.add(occurrenceKey);
  }

  return {
    entries: mergedEntries,
    summary: {
      addedFromPublished,
      updatedFromPublished,
      removedFromPublished,
      preservedDraftChanges: draftChangedKeys.size,
      conflicts,
    },
  };
}
