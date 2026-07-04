import type { WorkOrder } from '../models/WorkOrder';
import * as workOrderApi from '../services/workOrderApi';

export class WorkOrderStore {
  static workOrders: WorkOrder[] = [];
  static current?: WorkOrder;

  static async load(keyword: string = ''): Promise<WorkOrder[]> {
    const data = await workOrderApi.fetchWorkOrders(keyword, 1);
    WorkOrderStore.workOrders = data.workOrders;
    if (!WorkOrderStore.current && data.workOrders.length > 0) {
      WorkOrderStore.current = data.workOrders[0];
    }
    return WorkOrderStore.workOrders;
  }

  static select(order: WorkOrder) {
    WorkOrderStore.current = order;
  }
}
