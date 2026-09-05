type OrderedStep = { sequenceGroup: number; materialSequenceGroup?: number | null };

export function materialSequenceGroup(step: OrderedStep) {
  return step.materialSequenceGroup ?? step.sequenceGroup;
}

/** A transaction-local projection; never persist it as the display order. */
export function projectMaterialSequence<T extends OrderedStep>(steps: T[]): T[] {
  return steps.map(step => ({ ...step, sequenceGroup: materialSequenceGroup(step) }))
    .sort((left, right) => left.sequenceGroup - right.sequenceGroup);
}
