import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import type { PickedFile } from '../platform/FilePickerAdapter';
import * as resourceApi from '../services/resourceApi';
import * as workOrderApi from '../services/workOrderApi';

export class ResourceStore {
  static categories: ResourceCategory[] = [];
  static files: ResourceFile[] = [];
  static currentCategoryId: string = '';
  static selectedFile?: ResourceFile;

  static async load(workOrderId: string): Promise<void> {
    const data = await workOrderApi.fetchWorkOrderResources(workOrderId);
    ResourceStore.categories = data.categories;
    ResourceStore.files = data.files;
    const stillExists = data.categories.some(category => category.id === ResourceStore.currentCategoryId);
    if ((!ResourceStore.currentCategoryId || !stillExists) && data.categories.length > 0) {
      ResourceStore.currentCategoryId = data.categories[0].id;
    }
    const files = ResourceStore.filesForCategory(ResourceStore.currentCategoryId);
    ResourceStore.selectedFile = files.length > 0 ? files[0] : undefined;
  }

  static filesForCategory(categoryId: string): ResourceFile[] {
    return ResourceStore.files.filter(file => file.categoryId === categoryId);
  }

  static selectCategory(categoryId: string): ResourceFile[] {
    ResourceStore.currentCategoryId = categoryId;
    const files = ResourceStore.filesForCategory(categoryId);
    ResourceStore.selectedFile = files.length > 0 ? files[0] : undefined;
    return files;
  }

  static selectFile(file?: ResourceFile): void {
    ResourceStore.selectedFile = file;
  }

  static async upload(workOrderId: string, categoryId: string, file: PickedFile): Promise<ResourceFile> {
    const data = await resourceApi.uploadResourceFile(workOrderId, categoryId, file);
    const nextFiles: ResourceFile[] = [data.file];
    ResourceStore.files.forEach((item: ResourceFile): void => {
      if (item.id !== data.file.id) {
        nextFiles.push(item);
      }
    });
    ResourceStore.files = nextFiles;
    ResourceStore.currentCategoryId = categoryId;
    ResourceStore.selectedFile = data.file;
    return data.file;
  }

  static async deleteSelected(workOrderId: string, file: ResourceFile): Promise<void> {
    await resourceApi.deleteResourceFile(file.id);
    await ResourceStore.load(workOrderId);
  }
}
