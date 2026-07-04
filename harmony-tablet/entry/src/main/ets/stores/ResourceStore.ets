import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import * as workOrderApi from '../services/workOrderApi';

export class ResourceStore {
  static categories: ResourceCategory[] = [];
  static files: ResourceFile[] = [];
  static currentCategoryId: string = '';

  static async load(workOrderId: string): Promise<void> {
    const data = await workOrderApi.fetchWorkOrderResources(workOrderId);
    ResourceStore.categories = data.categories;
    ResourceStore.files = data.files;
    if (!ResourceStore.currentCategoryId && data.categories.length > 0) {
      ResourceStore.currentCategoryId = data.categories[0].id;
    }
  }

  static filesForCategory(categoryId: string): ResourceFile[] {
    return ResourceStore.files.filter(file => file.categoryId === categoryId);
  }
}
