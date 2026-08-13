export type ProcessReportQuantityBasis = 'product' | 'action';

export function normalizeProcessReportQuantityBasis(value: unknown): ProcessReportQuantityBasis {
  return value === 'action' ? 'action' : 'product';
}

export function processReportTargetQuantity(input: {
  productTargetQty: number;
  basis: ProcessReportQuantityBasis;
  unitsPerProduct: number;
}): number {
  const multiplier = input.basis === 'action' ? input.unitsPerProduct : 1;
  const target = input.productTargetQty * multiplier;
  if (!Number.isSafeInteger(target) || target < 0) {
    throw new Error('报工目标数量超出系统可计算范围');
  }
  return target;
}

export function resolveProcessReportQuantities(input: {
  basis: ProcessReportQuantityBasis;
  productProcessedQty: number;
  productDefectQty: number;
  reportedUnitQty: number;
  reportedDefectUnitQty: number;
}) {
  const productGoodQty = input.productProcessedQty - input.productDefectQty;
  if (input.basis === 'product') {
    return {
      reportedUnitQty: input.productProcessedQty,
      reportedGoodUnitQty: productGoodQty,
      reportedDefectUnitQty: input.productDefectQty,
      productGoodQty,
    };
  }
  return {
    reportedUnitQty: input.reportedUnitQty,
    reportedGoodUnitQty: input.reportedUnitQty - input.reportedDefectUnitQty,
    reportedDefectUnitQty: input.reportedDefectUnitQty,
    productGoodQty,
  };
}

export function assertActionFlowDoesNotExceedReportedOutput(input: {
  unitsPerProduct: number;
  previousProductGoodQty: number;
  nextProductGoodQty: number;
  previousReportedGoodUnitQty: number;
  nextReportedGoodUnitQty: number;
}): void {
  const productGoodQty = input.previousProductGoodQty + input.nextProductGoodQty;
  const reportedGoodUnitQty = input.previousReportedGoodUnitQty + input.nextReportedGoodUnitQty;
  if (productGoodQty * input.unitsPerProduct > reportedGoodUnitQty) {
    throw new Error(
      `累计整套良品超过动作产出：每套需要 ${input.unitsPerProduct} 个合格动作，请先核对“实际动作数量”和“形成整套数量”`,
    );
  }
}
