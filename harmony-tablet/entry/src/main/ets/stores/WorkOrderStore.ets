import type { WorkOrder } from '../models/WorkOrder';
import * as workOrderApi from '../services/workOrderApi';
import type { WorkOrderCreateRequest, WorkOrderUpdateRequest } from '../services/workOrderApi';

export class WorkOrderStore {
  static workOrders: WorkOrder[] = [];
  static current?: WorkOrder;

  static async load(keyword: string = ''): Promise<WorkOrder[]> {
    const data = await workOrderApi.fetchWorkOrders(keyword, 1);
    WorkOrderStore.workOrders = data.workOrders;
    if (data.workOrders.length === 0) {
      WorkOrderStore.current = undefined;
      return WorkOrderStore.workOrders;
    }

    let currentStillVisible = false;
    if (WorkOrderStore.current) {
      for (let i = 0; i < data.workOrders.length; i++) {
        if (data.workOrders[i].id === WorkOrderStore.current.id) {
          currentStillVisible = true;
        }
      }
    }
    if (!WorkOrderStore.current || !currentStillVisible) {
      WorkOrderStore.current = data.workOrders[0];
    }
    return WorkOrderStore.workOrders;
  }

  static select(order: WorkOrder): void {
    WorkOrderStore.current = order;
  }

  static async loadDetail(id: string): Promise<WorkOrder> {
    const data = await workOrderApi.fetchWorkOrder(id);
    WorkOrderStore.current = data.workOrder;
    return data.workOrder;
  }

  static async create(body: WorkOrderCreateRequest): Promise<WorkOrder> {
    const data = await workOrderApi.createWorkOrder(body);
    WorkOrderStore.current = data.workOrder;
    await WorkOrderStore.load('');
    WorkOrderStore.current = data.workOrder;
    return data.workOrder;
  }

  static async update(id: string, body: WorkOrderUpdateRequest): Promise<WorkOrder> {
    const data = await workOrderApi.updateWorkOrder(id, body);
    WorkOrderStore.current = data.workOrder;
    return data.workOrder;
  }

  static async softDelete(order: WorkOrder): Promise<void> {
    await workOrderApi.deleteWorkOrder(order.id, `${order.code} CONFIRM`);
    WorkOrderStore.current = undefined;
    await WorkOrderStore.load('');
  }

  static async restore(id: string): Promise<WorkOrder> {
    const data = await workOrderApi.restoreWorkOrder(id);
    WorkOrderStore.current = data.workOrder;
    await WorkOrderStore.load('');
    WorkOrderStore.current = data.workOrder;
    return data.workOrder;
  }
}
