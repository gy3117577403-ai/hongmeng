export type ProductionPrimaryAction =
  | 'view_detail'
  | 'view_workflow'
  | 'advance_route';

export function resolveProductionPrimaryAction(input: {
  readOnly: boolean;
  aggregateCompleted: boolean;
  awaitingBranchClosure: boolean;
  canAdministerProduction: boolean;
  routeNeedsMaintenance: boolean;
  drawingNotIssued: boolean;
}): ProductionPrimaryAction {
  if (input.readOnly) return 'view_detail';
  if (input.aggregateCompleted || input.awaitingBranchClosure) return 'view_workflow';
  if (
    !input.canAdministerProduction
    && (input.routeNeedsMaintenance || input.drawingNotIssued)
  ) {
    return 'view_detail';
  }
  return 'advance_route';
}
