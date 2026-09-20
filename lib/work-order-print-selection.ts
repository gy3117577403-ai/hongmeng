// Only absent optional categories may be omitted; invalid files or approval failures still block.
export function optionalPrintMaterialAbsent(code: string): boolean {
  return ["FIXTURE_DRAWING_NOT_PROVIDED", "FIXTURE_SOP_NOT_PROVIDED", "QR_DRAWING_REQUIRED", "QR_SOP_REQUIRED", "QR_DRAWING_PRODUCT_LINK_REQUIRED", "QR_SOP_PRODUCT_LINK_REQUIRED"].includes(code);
}
