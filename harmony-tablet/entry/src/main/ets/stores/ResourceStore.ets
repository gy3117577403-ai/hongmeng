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
    ResourceStore.files = data.files;
    const sourceCategories = data.categories.length > 0 ? data.categories : ResourceStore.defaultCategories();
    ResourceStore.categories = ResourceStore.applyFileCounts(sourceCategories, data.files);
    if (ResourceStore.categories.length > 0) {
      ResourceStore.currentCategoryId = ResourceStore.categories[0].id;
    } else {
      ResourceStore.currentCategoryId = '';
    }
    const files = ResourceStore.filesForCategory(ResourceStore.currentCategoryId);
    ResourceStore.selectedFile = files.length > 0 ? files[0] : undefined;
  }

  static applyFileCounts(categories: ResourceCategory[], files: ResourceFile[]): ResourceCategory[] {
    const next: ResourceCategory[] = [];
    for (let i = 0; i < categories.length; i++) {
      const item = categories[i];
      const category: ResourceCategory = {
        id: item.id,
        code: item.code,
        name: item.name,
        required: item.required,
        sortOrder: item.sortOrder,
        fileCount: ResourceStore.countFilesForCategory(item, files)
      };
      next.push(category);
    }
    return next;
  }

  static countFilesForCategory(category: ResourceCategory, files: ResourceFile[]): number {
    let count = 0;
    for (let i = 0; i < files.length; i++) {
      if (ResourceStore.fileMatchesCategory(files[i], category)) {
        count++;
      }
    }
    return count;
  }

  static filesForCategory(categoryId: string): ResourceFile[] {
    const category = ResourceStore.categoryForId(categoryId);
    const result: ResourceFile[] = [];
    for (let i = 0; i < ResourceStore.files.length; i++) {
      const file = ResourceStore.files[i];
      if (category) {
        if (ResourceStore.fileMatchesCategory(file, category)) {
          result.push(file);
        }
      } else if (file.categoryId === categoryId) {
        result.push(file);
      }
    }
    return result;
  }

  static categoryForId(categoryId: string): ResourceCategory | undefined {
    for (let i = 0; i < ResourceStore.categories.length; i++) {
      if (ResourceStore.categories[i].id === categoryId) {
        return ResourceStore.categories[i];
      }
    }
    return undefined;
  }

  static fileMatchesCategory(file: ResourceFile, category: ResourceCategory): boolean {
    if (file.categoryId === category.id) return true;
    if (file.categoryCode && file.categoryCode === category.code) return true;
    if (file.categoryName && file.categoryName === category.name) return true;
    return false;
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

  static async updateSelected(workOrderId: string, file: ResourceFile, displayName: string, remark: string, categoryId: string): Promise<ResourceFile> {
    const data = await resourceApi.updateResourceFile(file.id, {
      displayName: displayName,
      remark: remark,
      categoryId: categoryId
    });
    await ResourceStore.load(workOrderId);
    ResourceStore.selectFile(data.file);
    return data.file;
  }

  static async restoreFile(workOrderId: string, fileId: string): Promise<ResourceFile> {
    const data = await resourceApi.restoreResourceFile(fileId);
    await ResourceStore.load(workOrderId);
    ResourceStore.selectFile(data.file);
    return data.file;
  }
}
