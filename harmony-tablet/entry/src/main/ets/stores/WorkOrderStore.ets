import type { WorkOrder } from '../models/WorkOrder';
import * as workOrderApi from '../services/workOrderApi';

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
}
