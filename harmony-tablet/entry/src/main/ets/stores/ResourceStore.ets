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

  static defaultCategories(): ResourceCategory[] {
    const categories: ResourceCategory[] = [
      { id: 'drawing', code: 'drawing', name: '原图', required: true, sortOrder: 1, fileCount: 0 },
      { id: 'sop', code: 'sop', name: 'SOP指导书', required: true, sortOrder: 2, fileCount: 0 },
      { id: 'product', code: 'product', name: '成品图', required: true, sortOrder: 3, fileCount: 0 },
      { id: 'material', code: 'material', name: '辅料规格', required: false, sortOrder: 4, fileCount: 0 },
      { id: 'notice', code: 'notice', name: '注意事项', required: false, sortOrder: 5, fileCount: 0 }
    ];
    return categories;
  }

  static async load(workOrderId: string): Promise<void> {
    const data = await workOrderApi.fetchWorkOrderResources(workOrderId);
    ResourceStore.categories = data.categories.length > 0 ? data.categories : ResourceStore.defaultCategories();
    ResourceStore.files = data.files;
    let stillExists = false;
    for (let i = 0; i < ResourceStore.categories.length; i++) {
      if (ResourceStore.categories[i].id === ResourceStore.currentCategoryId) {
        stillExists = true;
      }
    }
    if ((!ResourceStore.currentCategoryId || !stillExists) && ResourceStore.categories.length > 0) {
      ResourceStore.currentCategoryId = ResourceStore.categories[0].id;
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
