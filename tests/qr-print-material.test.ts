import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkOrderQrPrintMaterial, WorkOrderQrPrintMode } from '@prisma/client';
import { resolveWorkOrderQrPrintMaterials, WorkOrderQrServiceError } from '../lib/work-order-qr-service';

test('print presets resolve to the intended material groups', () => {
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.TRAVELER_ONLY), [
    WorkOrderQrPrintMaterial.TRAVELER,
  ]);
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.TRAVELER_SOP_DUPLEX), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.SOP,
  ]);
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.DRAWING_SOP_TRAVELER_SEPARATE), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.SOP,
    WorkOrderQrPrintMaterial.DRAWING,
  ]);
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.DRAWING_SEPARATE_TRAVELER_SOP_DUPLEX), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.SOP,
    WorkOrderQrPrintMaterial.DRAWING,
  ]);
});

test('custom reprint keeps only supported materials in stable order', () => {
  assert.deepEqual(resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.CUSTOM, ['drawing', 'TRAVELER', 'drawing']), [
    WorkOrderQrPrintMaterial.TRAVELER,
    WorkOrderQrPrintMaterial.DRAWING,
  ]);
  assert.throws(
    () => resolveWorkOrderQrPrintMaterials(WorkOrderQrPrintMode.CUSTOM, ['unsupported']),
    (error: unknown) => error instanceof WorkOrderQrServiceError && error.code === 'QR_PRINT_MATERIAL_REQUIRED',
  );
});
