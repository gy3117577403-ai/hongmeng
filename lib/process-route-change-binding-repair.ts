import {
  DailyProcessTaskStatus,
  Prisma,
  PrismaClient,
  ProcessRouteChangeDiffKind,
  ProcessRouteChangeStatus,
} from '@prisma/client';

type RepairDb = Prisma.TransactionClient | PrismaClient;

export type LegacyBindingRepairMode =
  | 'NOT_AFFECTED'
  | 'DIFF_ONLY'
  | 'ACTIVE_EXISTING_PROFILE'
  | 'ACTIVE_CORRECTIVE_DRAFT'
  | 'BLOCKED';

export type LegacyBindingFacts = {
  activeCompletions: number;
  activeExecutions: number;
  laborPools: number;
  activeMovements: number;
  processedQuantity: number;
  reportedSupplementQuantity: number;
};

export type LegacyBindingAssessmentInput = {
  status: string;
  requestedName: string | null;
  boundDefinition: { id: string; name: string } | null;
  anchorDefinitionId: string | null;
  matchingDefinitionIds: string[];
  displayStepCount?: number;
  publishedProfileCount?: number;
  publishedEntryCount?: number;
  publishedEntryDefinitionId?: string | null;
  desiredDefinitionId?: string | null;
  repairDraftState?: 'none' | 'repair' | 'business' | 'multiple';
  repairDraftEntryCount?: number;
  identityConflicts?: string[];
  facts?: LegacyBindingFacts;
};

export type LegacyBindingAssessment = {
  affected: boolean;
  mode: LegacyBindingRepairMode;
  blockers: string[];
};

export type LegacyBindingRepairFinding = {
  changeId: string;
  diffId: string;
  workOrderId: string;
  workOrderCode: string | null;
  status: string;
  requestedName: string;
  pollutedDefinitionId: string;
  pollutedDefinitionName: string;
  desiredDefinitionId: string | null;
  desiredDefinitionName: string | null;
  occurrenceKey: string;
  mode: LegacyBindingRepairMode;
  blockers: string[];
  facts: LegacyBindingFacts | null;
  displayStepId: string | null;
  obligationId: string | null;
  publishedProfileId: string | null;
  correctiveDraftId: string | null;
  correctiveDraftCreated: boolean;
  updatedDailyTasks: number;
  executed: boolean;
  pendingProductTimePublish: boolean;
};

export type LegacyBindingRepairReport = {
  mode: 'dry-run' | 'execute';
  scannedInsertDiffs: number;
  affected: number;
  repairable: number;
  blocked: number;
  repaired: number;
  pendingProductTimePublish: number;
  findings: LegacyBindingRepairFinding[];
};

export type CorrectiveDraftSourceEntry = {
  id: string;
  profileId: string;
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
  reportQuantityBasis?: string;
  reportUnitLabel?: string;
  countsForEfficiency: boolean;
  remark: string | null;
};

export function buildCorrectiveDraftEntries(
  entries: CorrectiveDraftSourceEntry[],
  targetOccurrenceKey: string,
  desiredDefinitionId: string,
) {
  if (entries.filter(entry => entry.occurrenceKey === targetOccurrenceKey).length !== 1) {
    throw new Error(`corrective draft target occurrence is not unique: ${targetOccurrenceKey}`);
  }
  return entries.map(entry => ({
    processDefinitionId: entry.occurrenceKey === targetOccurrenceKey
      ? desiredDefinitionId
      : entry.processDefinitionId,
    occurrenceKey: entry.occurrenceKey,
    position: entry.position,
    sequenceGroup: entry.sequenceGroup,
    timeBasis: entry.timeBasis,
    unitMilliseconds: entry.unitMilliseconds,
    actionMilliseconds: entry.actionMilliseconds,
    occurrences: entry.occurrences,
    setupMilliseconds: entry.setupMilliseconds,
    unitLabel: entry.unitLabel,
    reportQuantityBasis: entry.reportQuantityBasis || 'product',
    reportUnitLabel: entry.reportUnitLabel || entry.unitLabel,
    countsForEfficiency: entry.countsForEfficiency,
    remark: entry.remark,
  }));
}

const EMPTY_FACTS: LegacyBindingFacts = {
  activeCompletions: 0,
  activeExecutions: 0,
  laborPools: 0,
  activeMovements: 0,
  processedQuantity: 0,
  reportedSupplementQuantity: 0,
};

const REPAIR_DRAFT_SOURCE = 'route_change_binding_repair';
const TERMINAL_DAILY_TASK_STATUSES = [
  DailyProcessTaskStatus.COMPLETED,
  DailyProcessTaskStatus.CARRIED_OVER,
  DailyProcessTaskStatus.CANCELLED,
];

function normalizedName(value: string | null | undefined): string {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonData(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function totalFacts(facts: LegacyBindingFacts): number {
  return facts.activeCompletions
    + facts.activeExecutions
    + facts.laborPools
    + facts.activeMovements
    + facts.processedQuantity
    + facts.reportedSupplementQuantity;
}

type RepairProfileEntry = NonNullable<CandidateContext['publishedProfile']>['entries'][number];

function sameEntryShape(left: RepairProfileEntry, right: RepairProfileEntry): boolean {
  return left.occurrenceKey === right.occurrenceKey
    && left.position === right.position
    && left.sequenceGroup === right.sequenceGroup
    && left.timeBasis === right.timeBasis
    && left.unitMilliseconds === right.unitMilliseconds
    && left.actionMilliseconds === right.actionMilliseconds
    && left.occurrences === right.occurrences
    && left.setupMilliseconds === right.setupMilliseconds
    && left.unitLabel === right.unitLabel
    && left.countsForEfficiency === right.countsForEfficiency
    && left.remark === right.remark;
}

export function assessLegacyInsertedBinding(input: LegacyBindingAssessmentInput): LegacyBindingAssessment {
  const requested = normalizedName(input.requestedName);
  const bound = normalizedName(input.boundDefinition?.name);
  if (!requested || !bound || requested === bound || !input.boundDefinition || !input.anchorDefinitionId) {
    return { affected: false, mode: 'NOT_AFFECTED', blockers: [] };
  }
  if (input.boundDefinition.id !== input.anchorDefinitionId) {
    return { affected: false, mode: 'NOT_AFFECTED', blockers: [] };
  }

  const blockers: string[] = [];
  if (input.matchingDefinitionIds.length === 0) blockers.push('REQUESTED_DEFINITION_MISSING');
  if (input.matchingDefinitionIds.length > 1) blockers.push('REQUESTED_DEFINITION_AMBIGUOUS');
  if (input.status === ProcessRouteChangeStatus.ACTIVATING) blockers.push('CHANGE_ACTIVATING');
  if (blockers.length) return { affected: true, mode: 'BLOCKED', blockers };

  if (input.status !== ProcessRouteChangeStatus.ACTIVE) {
    return { affected: true, mode: 'DIFF_ONLY', blockers: [] };
  }

  if ((input.displayStepCount ?? 0) !== 1) blockers.push('DISPLAY_STEP_NOT_UNIQUE');
  if ((input.publishedProfileCount ?? 0) !== 1) blockers.push('CURRENT_PUBLISHED_PROFILE_NOT_UNIQUE');
  if ((input.publishedEntryCount ?? 0) !== 1) blockers.push('OCCURRENCE_ENTRY_NOT_UNIQUE');
  if (input.identityConflicts?.length) blockers.push(...input.identityConflicts);
  if (totalFacts(input.facts || EMPTY_FACTS) > 0) blockers.push('PRODUCTION_FACTS_EXIST');

  const desiredId = input.desiredDefinitionId || input.matchingDefinitionIds[0] || null;
  const publishedEntryDefinitionId = input.publishedEntryDefinitionId || null;
  if (publishedEntryDefinitionId && desiredId
    && publishedEntryDefinitionId !== input.boundDefinition.id
    && publishedEntryDefinitionId !== desiredId) {
    blockers.push('PUBLISHED_ENTRY_CHANGED_BY_OTHER_WORK');
  }

  if (publishedEntryDefinitionId !== desiredId) {
    if (input.repairDraftState === 'business' || input.repairDraftState === 'multiple') {
      blockers.push('EXISTING_BUSINESS_DRAFT_CONFLICT');
    }
    if (input.repairDraftState === 'repair' && (input.repairDraftEntryCount ?? 0) !== 1) {
      blockers.push('REPAIR_DRAFT_OCCURRENCE_NOT_UNIQUE');
    }
  }

  if (blockers.length) return { affected: true, mode: 'BLOCKED', blockers: [...new Set(blockers)] };
  return {
    affected: true,
    mode: publishedEntryDefinitionId === desiredId
      ? 'ACTIVE_EXISTING_PROFILE'
      : 'ACTIVE_CORRECTIVE_DRAFT',
    blockers: [],
  };
}

type CandidateContext = {
  finding: LegacyBindingRepairFinding;
  requestedName: string;
  afterData: Record<string, unknown>;
  desiredDefinition: { id: string; code: string; name: string; stageGroup: string } | null;
  displayStepId: string | null;
  routeId: string;
  routeVersion: number;
  publishedProfile: {
    id: string;
    drawingLibraryItemId: string;
    version: number;
    entries: CorrectiveDraftSourceEntry[];
  } | null;
  publishedOccurrenceEntryId: string | null;
  repairDraftId: string | null;
  repairDraftOccurrenceEntryId: string | null;
};

async function inspectCandidate(db: RepairDb, diffId: string): Promise<CandidateContext | null> {
  const diff = await db.processRouteChangeDiff.findUnique({
    where: { id: diffId },
    include: {
      processDefinition: { select: { id: true, code: true, name: true, stageGroup: true } },
      targetStep: { select: { id: true, processDefinitionId: true } },
      supplementObligation: {
        include: { displayStep: true },
      },
      change: {
        include: {
          workOrder: { select: { id: true, code: true, drawingLibraryItemId: true } },
          route: { select: { version: true } },
        },
      },
    },
  });
  if (!diff || diff.kind !== ProcessRouteChangeDiffKind.INSERT_STEP) return null;
  const afterData = jsonRecord(diff.afterData);
  const requestedName = typeof afterData.processName === 'string' ? afterData.processName.trim() : '';
  const activeDefinitions = requestedName
    ? await db.processDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, code: true, name: true, stageGroup: true },
      })
    : [];
  const matches = activeDefinitions.filter(definition => normalizedName(definition.name) === normalizedName(requestedName));
  const desiredDefinition = matches.length === 1 ? matches[0] : null;
  const occurrenceKey = `route-change:${diff.changeId}:${diff.id}`;
  const baseAssessment = assessLegacyInsertedBinding({
    status: diff.change.status,
    requestedName,
    boundDefinition: diff.processDefinition,
    anchorDefinitionId: diff.targetStep?.processDefinitionId || null,
    matchingDefinitionIds: matches.map(item => item.id),
  });
  if (!baseAssessment.affected) return null;

  const emptyFinding: LegacyBindingRepairFinding = {
    changeId: diff.changeId,
    diffId: diff.id,
    workOrderId: diff.change.workOrderId,
    workOrderCode: diff.change.workOrder.code,
    status: diff.change.status,
    requestedName,
    pollutedDefinitionId: diff.processDefinition?.id || '',
    pollutedDefinitionName: diff.processDefinition?.name || '',
    desiredDefinitionId: desiredDefinition?.id || null,
    desiredDefinitionName: desiredDefinition?.name || null,
    occurrenceKey,
    mode: baseAssessment.mode,
    blockers: baseAssessment.blockers,
    facts: null,
    displayStepId: null,
    obligationId: diff.supplementObligation?.id || null,
    publishedProfileId: null,
    correctiveDraftId: null,
    correctiveDraftCreated: false,
    updatedDailyTasks: 0,
    executed: false,
    pendingProductTimePublish: false,
  };

  if (baseAssessment.mode === 'BLOCKED' || diff.change.status !== ProcessRouteChangeStatus.ACTIVE) {
    return {
      finding: emptyFinding,
      requestedName,
      afterData,
      desiredDefinition,
      displayStepId: null,
      routeId: diff.change.routeId,
      routeVersion: diff.change.route.version,
      publishedProfile: null,
      publishedOccurrenceEntryId: null,
      repairDraftId: null,
      repairDraftOccurrenceEntryId: null,
    };
  }

  const drawingLibraryItemId = diff.change.workOrder.drawingLibraryItemId;
  const publishedProfiles = drawingLibraryItemId
    ? await db.productTimeProfile.findMany({
        where: { drawingLibraryItemId, status: 'published' },
        orderBy: [{ version: 'desc' }, { id: 'asc' }],
        include: { entries: { orderBy: { position: 'asc' } } },
      })
    : [];
  const publishedProfile = publishedProfiles.length === 1 ? publishedProfiles[0] : null;
  const publishedOccurrenceEntries = publishedProfile?.entries.filter(entry => entry.occurrenceKey === occurrenceKey) || [];
  const repairDrafts = drawingLibraryItemId
    ? await db.productTimeProfile.findMany({
        where: { drawingLibraryItemId, status: 'draft' },
        include: { entries: { orderBy: { position: 'asc' } } },
      })
    : [];
  const repairDraftState: LegacyBindingAssessmentInput['repairDraftState'] = repairDrafts.length > 1
    ? 'multiple'
    : repairDrafts.length === 0
      ? 'none'
      : repairDrafts[0].sourceType === REPAIR_DRAFT_SOURCE ? 'repair' : 'business';

  const entrySteps = publishedOccurrenceEntries.length === 1
    ? await db.workOrderProcessStep.findMany({
        where: {
          routeId: diff.change.routeId,
          productTimeEntryId: publishedOccurrenceEntries[0].id,
        },
      })
    : [];
  const displaySteps = [
    ...(diff.supplementObligation?.displayStep ? [diff.supplementObligation.displayStep] : []),
    ...entrySteps,
  ].filter((step, index, all) => all.findIndex(candidate => candidate.id === step.id) === index);
  const displayStep = displaySteps.length === 1 ? displaySteps[0] : null;

  const [activeCompletions, activeExecutions, laborPools, activeMovements] = displayStep
    ? await Promise.all([
        db.processCompletion.count({
          where: {
            voidedAt: null,
            OR: [
              { stepId: displayStep.id },
              ...(diff.supplementObligation ? [{ supplementObligationId: diff.supplementObligation.id }] : []),
            ],
          },
        }),
        db.processExecution.count({ where: { stepId: displayStep.id, voidedAt: null } }),
        db.processLaborPool.count({
          where: { stepId: displayStep.id, completion: { voidedAt: null } },
        }),
        db.processQuantityMovement.count({
          where: {
            voidedAt: null,
            OR: [{ sourceStepId: displayStep.id }, { targetStepId: displayStep.id }],
          },
        }),
      ])
    : [0, 0, 0, 0];
  const facts: LegacyBindingFacts = {
    activeCompletions,
    activeExecutions,
    laborPools,
    activeMovements,
    processedQuantity: displayStep
      ? displayStep.inputQty + displayStep.processedQty + displayStep.goodOutputQty
        + displayStep.defectOutputQty + displayStep.releasedGoodQty
      : 0,
    reportedSupplementQuantity: diff.supplementObligation
      ? diff.supplementObligation.reportedQty
        + (diff.supplementObligation.lastReportedAt ? 1 : 0)
        + (diff.supplementObligation.fulfilledAt ? 1 : 0)
      : 0,
  };
  const identityConflicts: string[] = [];
  const allowedDefinitionIds = new Set([diff.processDefinitionId, desiredDefinition?.id].filter(Boolean));
  if (displayStep?.processDefinitionId && !allowedDefinitionIds.has(displayStep.processDefinitionId)) {
    identityConflicts.push('DISPLAY_STEP_CHANGED_BY_OTHER_WORK');
  }
  if (displayStep && (displayStep.startedAt || displayStep.completedAt || displayStep.retiredAt)) {
    identityConflicts.push('DISPLAY_STEP_HAS_LIFECYCLE_FACTS');
  }
  if (diff.supplementObligation?.processDefinitionId
    && !allowedDefinitionIds.has(diff.supplementObligation.processDefinitionId)) {
    identityConflicts.push('OBLIGATION_CHANGED_BY_OTHER_WORK');
  }
  const repairDraft = repairDraftState === 'repair' ? repairDrafts[0] : null;
  const repairDraftOccurrenceEntries = repairDraft?.entries.filter(
    entry => entry.occurrenceKey === occurrenceKey,
  ) || [];
  if (repairDraft && publishedProfile) {
    if (!repairDraft.remark?.includes(`base-profile:${publishedProfile.id}`)) {
      identityConflicts.push('REPAIR_DRAFT_BASE_PROFILE_UNVERIFIED');
    }
    const publishedByOccurrence = new Map(
      publishedProfile.entries.map(entry => [entry.occurrenceKey, entry] as const),
    );
    const exactOccurrenceSet = repairDraft.entries.length === publishedProfile.entries.length
      && repairDraft.entries.every(entry => publishedByOccurrence.has(entry.occurrenceKey));
    if (!exactOccurrenceSet) identityConflicts.push('REPAIR_DRAFT_OCCURRENCE_SET_CHANGED');

    const changedDefinitions = repairDraft.entries.filter(entry => {
      const baseEntry = publishedByOccurrence.get(entry.occurrenceKey);
      if (!baseEntry) return false;
      if (!sameEntryShape(baseEntry, entry)) {
        identityConflicts.push('REPAIR_DRAFT_ENTRY_CONTENT_CHANGED');
      }
      return baseEntry.processDefinitionId !== entry.processDefinitionId;
    });
    const targetDraftEntry = repairDraftOccurrenceEntries[0];
    const targetPublishedEntry = publishedByOccurrence.get(occurrenceKey);
    if (targetDraftEntry && targetPublishedEntry
      && targetDraftEntry.processDefinitionId !== targetPublishedEntry.processDefinitionId) {
      identityConflicts.push('REPAIR_DRAFT_TARGET_CHANGED_BY_OTHER_WORK');
    }
    const priorDefinitionChanges = changedDefinitions.filter(entry => entry.occurrenceKey !== occurrenceKey);
    if (priorDefinitionChanges.length) {
      const logs = await db.operationLog.findMany({
        where: {
          action: 'repair_process_route_change_definition_binding',
          targetType: 'process_route_change',
        },
        select: { detail: true },
      });
      const loggedChanges = new Set(logs.map(log => {
        const detail = jsonRecord(log.detail);
        if (detail.correctiveDraftId !== repairDraft.id) return '';
        return `${String(detail.occurrenceKey || '')}:${String(detail.toDefinitionId || '')}`;
      }).filter(Boolean));
      if (priorDefinitionChanges.some(entry => (
        !loggedChanges.has(`${entry.occurrenceKey}:${entry.processDefinitionId}`)
      ))) {
        identityConflicts.push('REPAIR_DRAFT_DEFINITION_CHANGE_UNVERIFIED');
      }
    }
  }

  const assessment = assessLegacyInsertedBinding({
    status: diff.change.status,
    requestedName,
    boundDefinition: diff.processDefinition,
    anchorDefinitionId: diff.targetStep?.processDefinitionId || null,
    matchingDefinitionIds: matches.map(item => item.id),
    displayStepCount: displaySteps.length,
    publishedProfileCount: publishedProfiles.length,
    publishedEntryCount: publishedOccurrenceEntries.length,
    publishedEntryDefinitionId: publishedOccurrenceEntries[0]?.processDefinitionId || null,
    desiredDefinitionId: desiredDefinition?.id || null,
    repairDraftState,
    repairDraftEntryCount: repairDraftOccurrenceEntries.length,
    identityConflicts,
    facts,
  });

  return {
    finding: {
      ...emptyFinding,
      mode: assessment.mode,
      blockers: assessment.blockers,
      facts,
      displayStepId: displayStep?.id || null,
      publishedProfileId: publishedProfile?.id || null,
      correctiveDraftId: repairDraft?.id || null,
    },
    requestedName,
    afterData,
    desiredDefinition,
    displayStepId: displayStep?.id || null,
    routeId: diff.change.routeId,
    routeVersion: diff.change.route.version,
    publishedProfile,
    publishedOccurrenceEntryId: publishedOccurrenceEntries[0]?.id || null,
    repairDraftId: repairDraft?.id || null,
    repairDraftOccurrenceEntryId: repairDraftOccurrenceEntries[0]?.id || null,
  };
}

async function cloneCorrectiveDraft(
  tx: Prisma.TransactionClient,
  context: CandidateContext,
  actorId: string | null,
): Promise<{ id: string; created: boolean }> {
  const published = context.publishedProfile;
  const desired = context.desiredDefinition;
  if (!published || !desired) throw new Error('repair context missing published profile or desired definition');
  if (context.repairDraftId && context.repairDraftOccurrenceEntryId) {
    await tx.productProcessTimeEntry.update({
      where: { id: context.repairDraftOccurrenceEntryId },
      data: { processDefinitionId: desired.id },
    });
    await tx.productTimeProfile.update({
      where: { id: context.repairDraftId },
      data: {
        revision: { increment: 1 },
        updatedById: actorId,
      },
    });
    return { id: context.repairDraftId, created: false };
  }

  const maxVersion = await tx.productTimeProfile.aggregate({
    where: { drawingLibraryItemId: published.drawingLibraryItemId },
    _max: { version: true },
  });
  const draft = await tx.productTimeProfile.create({
    data: {
      drawingLibraryItemId: published.drawingLibraryItemId,
      version: (maxVersion._max.version || 0) + 1,
      revision: 0,
      status: 'draft',
      sourceType: REPAIR_DRAFT_SOURCE,
      remark: `系统修复旧现场工艺绑定 ${context.finding.changeId}/${context.finding.diffId}`
        + `；base-profile:${published.id}；发布前请工艺复核`,
      createdById: actorId,
      updatedById: actorId,
    },
  });
  await tx.productProcessTimeEntry.createMany({
    data: buildCorrectiveDraftEntries(
      published.entries,
      context.finding.occurrenceKey,
      desired.id,
    ).map(entry => ({
      ...entry,
      profileId: draft.id,
    })),
  });
  return { id: draft.id, created: true };
}

async function executeOne(
  client: PrismaClient,
  diffId: string,
  actorId: string | null,
): Promise<LegacyBindingRepairFinding | null> {
  return client.$transaction(async tx => {
    const context = await inspectCandidate(tx, diffId);
    if (!context) return null;
    if (context.finding.mode === 'BLOCKED') return context.finding;
    const desired = context.desiredDefinition;
    if (!desired) return { ...context.finding, mode: 'BLOCKED', blockers: ['REQUESTED_DEFINITION_MISSING'] };

    if (context.finding.status === ProcessRouteChangeStatus.ACTIVE) {
      const routeUpdate = await tx.workOrderProcessRoute.updateMany({
        where: {
          id: context.routeId,
          version: context.routeVersion,
        },
        data: { version: { increment: 1 } },
      });
      if (routeUpdate.count !== 1) {
        throw new Error(`route changed during binding repair: ${context.routeId}`);
      }
    }

    await tx.processRouteChangeDiff.update({
      where: { id: context.finding.diffId },
      data: {
        processDefinitionId: desired.id,
        afterData: jsonData({
          ...context.afterData,
          processCode: desired.code,
          processName: desired.name,
          stageGroup: desired.stageGroup,
        }),
      },
    });

    let correctiveDraftId: string | null = null;
    let correctiveDraftCreated = false;
    let updatedDailyTasks = 0;
    let pendingProductTimePublish = false;
    if (context.finding.status === ProcessRouteChangeStatus.ACTIVE && context.displayStepId) {
      await tx.workOrderProcessStep.update({
        where: { id: context.displayStepId },
        data: {
          processDefinitionId: desired.id,
          processCode: desired.code,
          processName: desired.name,
          stageGroup: desired.stageGroup,
        },
      });
      if (context.finding.obligationId) {
        await tx.processSupplementObligation.update({
          where: { id: context.finding.obligationId },
          data: {
            processDefinitionId: desired.id,
            processCode: desired.code,
            processName: desired.name,
            stageGroup: desired.stageGroup,
            version: { increment: 1 },
          },
        });
      }
      const daily = await tx.dailyProcessTask.updateMany({
        where: {
          stepId: context.displayStepId,
          status: { notIn: TERMINAL_DAILY_TASK_STATUSES },
        },
        data: {
          processCode: desired.code,
          processName: desired.name,
          stageGroup: desired.stageGroup,
          version: { increment: 1 },
        },
      });
      updatedDailyTasks = daily.count;

      const publishedEntry = context.publishedProfile?.entries.find(
        entry => entry.id === context.publishedOccurrenceEntryId,
      );
      if (publishedEntry?.processDefinitionId !== desired.id) {
        const draft = await cloneCorrectiveDraft(tx, context, actorId);
        correctiveDraftId = draft.id;
        correctiveDraftCreated = draft.created;
        pendingProductTimePublish = true;
      }
    }

    await tx.operationLog.create({
      data: {
        userId: actorId,
        action: 'repair_process_route_change_definition_binding',
        targetType: 'process_route_change',
        targetId: context.finding.changeId,
        detail: jsonData({
          diffId: context.finding.diffId,
          occurrenceKey: context.finding.occurrenceKey,
          fromDefinitionId: context.finding.pollutedDefinitionId,
          fromDefinitionName: context.finding.pollutedDefinitionName,
          toDefinitionId: desired.id,
          toDefinitionName: desired.name,
          routeId: context.routeId,
          routeVersionBefore: context.routeVersion,
          routeVersionAfter: context.finding.status === ProcessRouteChangeStatus.ACTIVE
            ? context.routeVersion + 1
            : context.routeVersion,
          displayStepId: context.displayStepId,
          obligationId: context.finding.obligationId,
          correctiveDraftId,
          correctiveDraftCreated,
          pendingProductTimePublish,
          updatedDailyTasks,
        }),
      },
    });

    return {
      ...context.finding,
      correctiveDraftId,
      correctiveDraftCreated,
      updatedDailyTasks,
      executed: true,
      pendingProductTimePublish,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 60_000,
  });
}

async function candidateDiffIds(db: RepairDb, changeId?: string): Promise<string[]> {
  const rows = await db.processRouteChangeDiff.findMany({
    where: {
      kind: ProcessRouteChangeDiffKind.INSERT_STEP,
      ...(changeId ? { changeId } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return rows.map(row => row.id);
}

function report(mode: 'dry-run' | 'execute', scannedInsertDiffs: number, findings: LegacyBindingRepairFinding[]): LegacyBindingRepairReport {
  return {
    mode,
    scannedInsertDiffs,
    affected: findings.length,
    repairable: findings.filter(item => item.mode !== 'BLOCKED').length,
    blocked: findings.filter(item => item.mode === 'BLOCKED').length,
    repaired: findings.filter(item => item.executed).length,
    pendingProductTimePublish: findings.filter(item => item.pendingProductTimePublish).length,
    findings,
  };
}

export async function auditLegacyProcessRouteChangeBindings(
  db: RepairDb,
  options: { changeId?: string } = {},
): Promise<LegacyBindingRepairReport> {
  const ids = await candidateDiffIds(db, options.changeId);
  const findings: LegacyBindingRepairFinding[] = [];
  for (const id of ids) {
    const context = await inspectCandidate(db, id);
    if (context) findings.push(context.finding);
  }
  return report('dry-run', ids.length, findings);
}

export async function executeLegacyProcessRouteChangeBindingRepairs(
  client: PrismaClient,
  options: { changeId?: string; actorId?: string | null } = {},
): Promise<LegacyBindingRepairReport> {
  if (options.actorId) {
    const actor = await client.user.findUnique({
      where: { id: options.actorId },
      select: { id: true },
    });
    if (!actor) throw new Error(`operation log actor does not exist: ${options.actorId}`);
  }
  const ids = await candidateDiffIds(client, options.changeId);
  const findings: LegacyBindingRepairFinding[] = [];
  for (const id of ids) {
    const finding = await executeOne(client, id, options.actorId || null);
    if (finding) findings.push(finding);
  }
  return report('execute', ids.length, findings);
}
