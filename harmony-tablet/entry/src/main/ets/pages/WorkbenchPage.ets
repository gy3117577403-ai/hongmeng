import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import type common from '@ohos.app.ability.common';
import { Colors } from '../constants/colors';
import { Routes } from '../constants/routes';
import { CurrentWorkOrderBar } from '../components/CurrentWorkOrderBar';
import { ResourceCategoryRail } from '../components/ResourceCategoryRail';
import { ResourcePreviewPanel } from '../components/ResourcePreviewPanel';
import { ResourceToolPanel } from '../components/ResourceToolPanel';
import { TopBar } from '../components/TopBar';
import { WorkOrderDrawer } from '../components/WorkOrderDrawer';
import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';
import { AuthStore } from '../stores/AuthStore';
import { ResourceStore } from '../stores/ResourceStore';
import { WorkOrderStore } from '../stores/WorkOrderStore';

@Entry
@Component
struct WorkbenchPage {
  @State loading: boolean = true;
  @State drawerOpen: boolean = false;
  @State toolCollapsed: boolean = false;
  @State orders: WorkOrder[] = [];
  @State current?: WorkOrder = undefined;
  @State categories: ResourceCategory[] = [];
  @State selectedCategoryId: string = '';
  @State files: ResourceFile[] = [];
  @State selectedFile?: ResourceFile = undefined;

  async aboutToAppear() {
    await this.load();
  }

  async load() {
    this.loading = true;
    try {
      this.orders = await WorkOrderStore.load();
      this.current = WorkOrderStore.current;
      if (this.current) {
        await this.loadResources(this.current.id);
      }
    } catch (err) {
      promptAction.showToast({ message: err instanceof Error ? err.message : '工作台加载失败' });
    } finally {
      this.loading = false;
    }
  }

  async loadResources(workOrderId: string) {
    await ResourceStore.load(workOrderId);
    this.categories = ResourceStore.categories;
    this.selectedCategoryId = ResourceStore.currentCategoryId;
    this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
    this.selectedFile = this.files.length > 0 ? this.files[0] : undefined;
  }

  async selectOrder(order: WorkOrder) {
    WorkOrderStore.select(order);
    this.current = order;
    this.drawerOpen = false;
    await this.loadResources(order.id);
  }

  selectCategory(category: ResourceCategory) {
    ResourceStore.currentCategoryId = category.id;
    this.selectedCategoryId = category.id;
    this.files = ResourceStore.filesForCategory(category.id);
    this.selectedFile = this.files.length > 0 ? this.files[0] : undefined;
  }

  async logout() {
    const context = getContext(this) as common.UIAbilityContext;
    await AuthStore.logout(context);
    router.replaceUrl({ url: Routes.login });
  }

  uploadTodo() {
    promptAction.showToast({ message: '文件选择和拍照上传需在 DevEco 真机环境继续接入' });
  }

  build() {
    Stack() {
      Column() {
        TopBar({
          username: AuthStore.user?.displayName || AuthStore.user?.username || '已登录',
          onOpenDrawer: () => this.drawerOpen = true,
          onLogout: () => this.logout()
        })
        Column() {
          CurrentWorkOrderBar({ order: this.current })
            .margin({ bottom: 14 })
          Row() {
            ResourceCategoryRail({
              categories: this.categories,
              selectedId: this.selectedCategoryId,
              onSelect: (category: ResourceCategory) => this.selectCategory(category)
            })
            Column() {
              ResourcePreviewPanel({ file: this.selectedFile })
                .layoutWeight(1)
              if (this.files.length > 0) {
                Scroll() {
                  Row() {
                    ForEach(this.files, (file: ResourceFile) => {
                      Text(file.displayName || file.originalName)
                        .height(44)
                        .maxWidth(220)
                        .fontSize(13)
                        .fontColor(file.id === this.selectedFile?.id ? Colors.primary : Colors.text)
                        .padding({ left: 12, right: 12 })
                        .backgroundColor(file.id === this.selectedFile?.id ? Colors.primaryLight : Colors.card)
                        .border({ width: 1, color: file.id === this.selectedFile?.id ? Colors.primary : Colors.border })
                        .borderRadius(12)
                        .margin({ right: 10 })
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .onClick(() => this.selectedFile = file)
                    })
                  }
                }
                .height(58)
                .margin({ top: 10 })
              }
            }
            .layoutWeight(1)
            .height('100%')
            .margin({ left: 12, right: 12 })
            ResourceToolPanel({
              collapsed: this.toolCollapsed,
              selectedFile: this.selectedFile,
              onToggle: () => this.toolCollapsed = !this.toolCollapsed,
              onUploadPdf: () => this.uploadTodo(),
              onUploadImage: () => this.uploadTodo(),
              onCameraUpload: () => this.uploadTodo()
            })
          }
          .layoutWeight(1)
        }
        .padding(16)
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(Colors.bg)
      if (this.loading) {
        Text('加载中...')
          .fontSize(18)
          .fontColor(Colors.textMuted)
          .padding(20)
          .backgroundColor(Colors.card)
          .borderRadius(14)
      }
      WorkOrderDrawer({
        visible: this.drawerOpen,
        orders: this.orders,
        selectedId: this.current?.id || '',
        onClose: () => this.drawerOpen = false,
        onSelect: (order: WorkOrder) => this.selectOrder(order)
      })
    }
    .width('100%')
    .height('100%')
  }
}
