import router from '@ohos.router';
import type common from '@ohos.app.ability.common';
import { Colors } from '../constants/colors';
import { Routes } from '../constants/routes';
import { CommonButton } from '../components/CommonButton';
import { CurrentWorkOrderBar } from '../components/CurrentWorkOrderBar';
import { ResourceCategoryRail } from '../components/ResourceCategoryRail';
import { ResourcePreviewPanel } from '../components/ResourcePreviewPanel';
import { ResourceToolPanel, UploadQueueItem } from '../components/ResourceToolPanel';
import { TopBar } from '../components/TopBar';
import { WorkOrderDrawer } from '../components/WorkOrderDrawer';
import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';
import { CameraAdapter } from '../platform/CameraAdapter';
import { DownloadAdapter } from '../platform/DownloadAdapter';
import { FilePickerAdapter, PickedFile } from '../platform/FilePickerAdapter';
import { ToastAdapter } from '../platform/ToastAdapter';
import { nativeDownloadUrl } from '../services/resourceApi';
import { ApiException } from '../services/httpClient';
import { AuthStore } from '../stores/AuthStore';
import { ResourceStore } from '../stores/ResourceStore';
import { WorkOrderStore } from '../stores/WorkOrderStore';

@Entry
@Component
struct WorkbenchPage {
  @State loading: boolean = true;
  @State drawerOpen: boolean = false;
  @State toolCollapsed: boolean = false;
  @State cameraOpen: boolean = false;
  @State orderKeyword: string = '';
  @State orders: WorkOrder[] = [];
  @State current?: WorkOrder = undefined;
  @State categories: ResourceCategory[] = [];
  @State selectedCategoryId: string = '';
  @State files: ResourceFile[] = [];
  @State selectedFile?: ResourceFile = undefined;
  @State uploadQueue: UploadQueueItem[] = [];

  async aboutToAppear() {
    if (!AuthStore.isAuthenticated()) {
      router.replaceUrl({ url: Routes.login });
      return;
    }
    await this.load();
  }

  async load() {
    this.loading = true;
    try {
      this.orders = await WorkOrderStore.load(this.orderKeyword);
      this.current = WorkOrderStore.current;
      if (this.current) {
        await this.loadResources(this.current.id);
      }
    } catch (err) {
      await this.handleError(err, '工作台加载失败');
    } finally {
      this.loading = false;
    }
  }

  async loadResources(workOrderId: string) {
    await ResourceStore.load(workOrderId);
    this.categories = ResourceStore.categories;
    this.selectedCategoryId = ResourceStore.currentCategoryId;
    this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
    this.selectedFile = ResourceStore.selectedFile || (this.files.length > 0 ? this.files[0] : undefined);
  }

  async selectOrder(order: WorkOrder) {
    WorkOrderStore.select(order);
    this.current = order;
    this.drawerOpen = false;
    await this.loadResources(order.id);
  }

  selectCategory(category: ResourceCategory) {
    ResourceStore.selectCategory(category.id);
    this.selectedCategoryId = category.id;
    this.files = ResourceStore.filesForCategory(category.id);
    this.selectedFile = ResourceStore.selectedFile;
  }

  selectFile(file: ResourceFile) {
    ResourceStore.selectFile(file);
    this.selectedFile = file;
  }

  async searchOrders(keyword: string) {
    this.orderKeyword = keyword;
    await this.load();
  }

  async logout() {
    const context = getContext(this) as common.UIAbilityContext;
    await AuthStore.logout(context);
    router.replaceUrl({ url: Routes.login });
  }

  async handleError(err: unknown, fallback: string) {
    if (err instanceof ApiException && err.needLogin) {
      const context = getContext(this) as common.UIAbilityContext;
      await AuthStore.handleUnauthorized(context);
      return;
    }
    ToastAdapter.error(err instanceof Error ? err.message : fallback);
  }

  async uploadPickedFiles(files: PickedFile[]) {
    if (!this.current || !this.selectedCategoryId) {
      ToastAdapter.error('请先选择工单和资料分类');
      return;
    }
    if (!files.length) {
      ToastAdapter.show('当前文件选择能力需在 DevEco 真机环境补齐');
      return;
    }
    for (const file of files) {
      const jobId = `${Date.now()}-${file.name}`;
      this.uploadQueue = [...this.uploadQueue, { id: jobId, name: file.name, status: '上传中', message: '正在上传到对象存储' }];
      try {
        const uploaded = await ResourceStore.upload(this.current.id, this.selectedCategoryId, file);
        this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
        this.selectedFile = uploaded;
        this.uploadQueue = this.uploadQueue.map(job => job.id === jobId ? { ...job, status: '成功', message: '上传完成' } : job);
      } catch (err) {
        this.uploadQueue = this.uploadQueue.map(job => job.id === jobId ? { ...job, status: '失败', message: err instanceof Error ? err.message : '上传失败，可稍后重试' } : job);
        await this.handleError(err, '上传失败');
      }
    }
  }

  async uploadPdf() {
    await this.uploadPickedFiles(await FilePickerAdapter.pickPdf());
  }

  async uploadImage() {
    await this.uploadPickedFiles(await FilePickerAdapter.pickImages());
  }

  async cameraUpload() {
    this.cameraOpen = true;
    if (!CameraAdapter.isSupported()) {
      ToastAdapter.show('当前原生相机能力需在 DevEco 真机环境补齐');
      return;
    }
    await CameraAdapter.openCamera();
  }

  async capturePhoto() {
    const photo = await CameraAdapter.takePhoto();
    if (photo) {
      this.cameraOpen = false;
      await this.uploadPickedFiles([photo]);
    } else {
      ToastAdapter.show('未获取到照片，可使用上传图片兜底');
    }
  }

  async downloadFile(file: ResourceFile) {
    await DownloadAdapter.downloadFile(file, nativeDownloadUrl(file));
  }

  async openFile(file: ResourceFile) {
    await DownloadAdapter.openFile(file, nativeDownloadUrl(file));
  }

  async deleteFile(file: ResourceFile) {
    if (!this.current) return;
    try {
      await ResourceStore.deleteSelected(this.current.id, file);
      this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
      this.selectedFile = ResourceStore.selectedFile;
      ToastAdapter.success('文件已软删除');
    } catch (err) {
      await this.handleError(err, '文件删除失败');
    }
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
              ResourcePreviewPanel({
                file: this.selectedFile,
                onUploadPdf: () => this.uploadPdf(),
                onUploadImage: () => this.uploadImage(),
                onCameraUpload: () => this.cameraUpload(),
                onDownload: (file: ResourceFile) => this.downloadFile(file),
                onOpen: (file: ResourceFile) => this.openFile(file)
              })
                .layoutWeight(1)
              if (this.files.length > 0) {
                Scroll() {
                  Row() {
                    ForEach(this.files, (file: ResourceFile) => {
                      Column() {
                        Text(file.displayName || file.originalName)
                          .fontSize(13)
                          .fontColor(file.id === this.selectedFile?.id ? Colors.primary : Colors.text)
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                        Text(file === this.files[0] ? `最新 · ${file.version || 'V1.0'}` : `历史 · ${file.version || 'V1.0'}`)
                          .fontSize(11)
                          .fontColor(Colors.textMuted)
                          .margin({ top: 4 })
                      }
                      .height(52)
                      .width(230)
                      .padding({ left: 12, right: 12, top: 8, bottom: 6 })
                      .backgroundColor(file.id === this.selectedFile?.id ? Colors.primaryLight : Colors.card)
                      .border({ width: 1, color: file.id === this.selectedFile?.id ? Colors.primary : Colors.border })
                      .borderRadius(12)
                      .margin({ right: 10 })
                      .onClick(() => this.selectFile(file))
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
              uploadQueue: this.uploadQueue,
              onToggle: () => this.toolCollapsed = !this.toolCollapsed,
              onUploadPdf: () => this.uploadPdf(),
              onUploadImage: () => this.uploadImage(),
              onCameraUpload: () => this.cameraUpload(),
              onDownload: (file: ResourceFile) => this.downloadFile(file),
              onOpen: (file: ResourceFile) => this.openFile(file),
              onDelete: (file: ResourceFile) => this.deleteFile(file)
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
        keyword: this.orderKeyword,
        onClose: () => this.drawerOpen = false,
        onSelect: (order: WorkOrder) => this.selectOrder(order),
        onSearch: (keyword: string) => this.searchOrders(keyword)
      })
      if (this.cameraOpen) {
        Column() {
          Text('拍照上传')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
          Text('当前原生相机能力需在 DevEco 真机环境补齐。可以先使用上传图片作为兜底入口。')
            .fontSize(15)
            .fontColor(Colors.textMuted)
            .textAlign(TextAlign.Center)
            .margin({ top: 14, bottom: 20 })
          Row() {
            CommonButton({ label: '拍照', enabled: CameraAdapter.isSupported(), onTap: () => this.capturePhoto() })
              .margin({ right: 12 })
            CommonButton({ label: '上传图片', primary: false, onTap: () => { this.cameraOpen = false; this.uploadImage(); } })
              .margin({ right: 12 })
            CommonButton({ label: '关闭', primary: false, onTap: () => { this.cameraOpen = false; CameraAdapter.release(); } })
          }
        }
        .width(460)
        .padding(28)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
    }
    .width('100%')
    .height('100%')
  }
}
