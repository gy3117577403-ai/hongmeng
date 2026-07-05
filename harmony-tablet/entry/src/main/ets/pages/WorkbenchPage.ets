import router from '@ohos.router';
import type common from '@ohos.app.ability.common';
import { Colors } from '../constants/colors';
import { API_BASE_URL } from '../constants/api';
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
import { ClipboardAdapter } from '../platform/ClipboardAdapter';
import { DownloadAdapter } from '../platform/DownloadAdapter';
import { FilePickerAdapter, PickedFile } from '../platform/FilePickerAdapter';
import { ToastAdapter } from '../platform/ToastAdapter';
import { VoiceInputAdapter } from '../platform/VoiceInputAdapter';
import { nativeDownloadUrl } from '../services/resourceApi';
import * as searchApi from '../services/searchApi';
import { downloadAllUrl } from '../services/workOrderApi';
import { ApiException } from '../services/httpClient';
import { AuthStore } from '../stores/AuthStore';
import { ResourceStore } from '../stores/ResourceStore';
import { WorkOrderStore } from '../stores/WorkOrderStore';
import { priorityLabel, stageLabel } from '../utils/format';

@Entry
@Component
struct WorkbenchPage {
  @State loading: boolean = true;
  @State drawerOpen: boolean = false;
  @State toolCollapsed: boolean = true;
  @State cameraOpen: boolean = false;
  @State orderKeyword: string = '';
  @State globalKeyword: string = '';
  @State orderStageFilter: string = '';
  @State loadError: string = '';
  @State resourceError: string = '';
  @State searchOpen: boolean = false;
  @State searchLoading: boolean = false;
  @State searchWorkOrders: WorkOrder[] = [];
  @State searchFiles: ResourceFile[] = [];
  @State orders: WorkOrder[] = [];
  @State current?: WorkOrder = undefined;
  @State categories: ResourceCategory[] = [];
  @State selectedCategoryId: string = '';
  @State files: ResourceFile[] = [];
  @State selectedFile?: ResourceFile = undefined;
  @State uploadQueue: UploadQueueItem[] = [];
  @State orderEditorOpen: boolean = false;
  @State orderDeleteOpen: boolean = false;
  @State fileDeleteOpen: boolean = false;
  @State filePendingDelete?: ResourceFile = undefined;
  @State editingOrderId: string = '';
  @State formCode: string = '';
  @State formCustomerName: string = '';
  @State formProductName: string = '';
  @State formStage: string = 'not_issued';
  @State formPriority: string = 'normal';
  @State formProgress: string = '0';
  @State formPlannedAt: string = '';
  @State formRemark: string = '';

  async aboutToAppear(): Promise<void> {
    if (!AuthStore.isAuthenticated()) {
      router.replaceUrl({ url: Routes.login });
      return;
    }
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    this.resourceError = '';
    try {
      this.orders = await WorkOrderStore.load(this.orderKeyword);
      this.current = WorkOrderStore.current;
      if (this.current) {
        this.current = await WorkOrderStore.loadDetail(this.current.id);
        await this.loadResources(this.current.id);
      } else {
        this.categories = [];
        this.selectedCategoryId = '';
        this.files = [];
        this.selectedFile = undefined;
      }
    } catch (err) {
      const error = err as Error;
      this.loadError = this.errorText(error, '工单加载失败');
      await this.handleError(error, '工单加载失败');
    } finally {
      this.loading = false;
    }
  }

  async loadResources(workOrderId: string): Promise<void> {
    this.resourceError = '';
    try {
      await ResourceStore.load(workOrderId);
      this.categories = ResourceStore.categories;
      this.selectedCategoryId = ResourceStore.currentCategoryId;
      this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
      this.selectedFile = ResourceStore.selectedFile || (this.files.length > 0 ? this.files[0] : undefined);
    } catch (err) {
      const error = err as Error;
      this.categories = ResourceStore.defaultCategories();
      this.selectedCategoryId = this.categories.length > 0 ? this.categories[0].id : '';
      this.files = [];
      this.selectedFile = undefined;
      this.resourceError = this.errorText(error, '资料分类加载失败');
      await this.handleError(error, '资料分类加载失败');
    }
  }

  async selectOrder(order: WorkOrder): Promise<void> {
    WorkOrderStore.select(order);
    this.drawerOpen = false;
    this.loadError = '';
    try {
      this.current = await WorkOrderStore.loadDetail(order.id);
      await this.loadResources(order.id);
    } catch (err) {
      const error = err as Error;
      this.current = order;
      this.loadError = this.errorText(error, '工单详情加载失败');
      await this.handleError(error, '工单详情加载失败');
    }
  }

  selectCategory(category: ResourceCategory): void {
    ResourceStore.selectCategory(category.id);
    this.selectedCategoryId = category.id;
    this.files = ResourceStore.filesForCategory(category.id);
    this.selectedFile = ResourceStore.selectedFile;
  }

  selectFile(file: ResourceFile): void {
    ResourceStore.selectFile(file);
    this.selectedFile = file;
  }

  async searchOrders(keyword: string): Promise<void> {
    this.orderKeyword = keyword;
    await this.load();
  }

  async searchGlobal(): Promise<void> {
    const keyword = this.globalKeyword.trim();
    if (keyword.length === 0) {
      ToastAdapter.show('请输入搜索关键词');
      return;
    }
    this.searchOpen = true;
    this.searchLoading = true;
    try {
      const data = await searchApi.searchNative(keyword);
      this.searchWorkOrders = data.workOrders;
      this.searchFiles = data.resourceFiles;
    } catch (err) {
      await this.handleError(err as Error, '全局搜索失败');
    } finally {
      this.searchLoading = false;
    }
  }

  async selectSearchOrder(order: WorkOrder): Promise<void> {
    this.searchOpen = false;
    await this.selectOrder(order);
  }

  async selectSearchFile(file: ResourceFile): Promise<void> {
    this.searchOpen = false;
    const order = await WorkOrderStore.loadDetail(file.workOrderId);
    await this.selectOrder(order);
    ResourceStore.selectCategory(file.categoryId);
    this.selectedCategoryId = file.categoryId;
    this.files = ResourceStore.filesForCategory(file.categoryId);
    for (let i = 0; i < this.files.length; i++) {
      if (this.files[i].id === file.id) {
        ResourceStore.selectFile(this.files[i]);
        this.selectedFile = this.files[i];
        return;
      }
    }
  }

  setOrderStageFilter(stage: string): void {
    this.orderStageFilter = stage;
  }

  openCreateOrder(): void {
    this.editingOrderId = '';
    this.formCode = '';
    this.formCustomerName = '';
    this.formProductName = '';
    this.formStage = 'not_issued';
    this.formPriority = 'normal';
    this.formProgress = '0';
    this.formPlannedAt = '';
    this.formRemark = '';
    this.orderEditorOpen = true;
  }

  openEditOrder(): void {
    if (!this.current) {
      ToastAdapter.error('请先选择工单');
      return;
    }
    this.editingOrderId = this.current.id;
    this.formCode = this.current.code;
    this.formCustomerName = this.current.customerName || '';
    this.formProductName = this.current.productName || '';
    this.formStage = this.current.stage || 'not_issued';
    this.formPriority = this.current.priority || 'normal';
    this.formProgress = `${this.current.progress || 0}`;
    this.formPlannedAt = this.current.plannedAt || '';
    this.formRemark = this.current.remark || '';
    this.orderEditorOpen = true;
  }

  setFormStage(stage: string): void {
    this.formStage = stage;
  }

  setFormPriority(priority: string): void {
    this.formPriority = priority;
  }

  stageOptions(): string[] {
    return ['not_issued', 'frontend', 'backend', 'completed'];
  }

  priorityOptions(): string[] {
    return ['urgent', 'high', 'normal'];
  }

  nextStageValue(current: string): string {
    const options = this.stageOptions();
    for (let i = 0; i < options.length; i++) {
      if (options[i] === current) {
        const next = i + 1 >= options.length ? 0 : i + 1;
        return options[next];
      }
    }
    return 'not_issued';
  }

  nextPriorityValue(current: string): string {
    const options = this.priorityOptions();
    for (let i = 0; i < options.length; i++) {
      if (options[i] === current) {
        const next = i + 1 >= options.length ? 0 : i + 1;
        return options[next];
      }
    }
    return 'normal';
  }

  async cycleCurrentStage(): Promise<void> {
    if (!this.current) return;
    try {
      this.current = await WorkOrderStore.update(this.current.id, { stage: this.nextStageValue(this.current.stage) });
      ToastAdapter.success('工单状态已更新');
    } catch (err) {
      await this.handleError(err as Error, '工单状态更新失败');
    }
  }

  async cycleCurrentPriority(): Promise<void> {
    if (!this.current) return;
    try {
      this.current = await WorkOrderStore.update(this.current.id, { priority: this.nextPriorityValue(this.current.priority) });
      ToastAdapter.success('工单优先级已更新');
    } catch (err) {
      await this.handleError(err as Error, '工单优先级更新失败');
    }
  }

  async voiceInputFallback(targetName: string = '全局搜索'): Promise<void> {
    await VoiceInputAdapter.startDictation(targetName);
  }

  async saveOrder(): Promise<void> {
    if (!this.formCode || !this.formProductName) {
      ToastAdapter.error('请填写工单号和产品名称');
      return;
    }
    const progress = Number(this.formProgress || 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      ToastAdapter.error('进度必须在 0-100 之间');
      return;
    }
    try {
      if (this.editingOrderId.length > 0) {
        this.current = await WorkOrderStore.update(this.editingOrderId, {
          code: this.formCode,
          customerName: this.formCustomerName,
          productName: this.formProductName,
          stage: this.formStage,
          priority: this.formPriority,
          progress: progress,
          plannedAt: this.formPlannedAt,
          remark: this.formRemark
        });
        ToastAdapter.success('工单已更新');
      } else {
        this.current = await WorkOrderStore.create({
          code: this.formCode,
          customerName: this.formCustomerName,
          productName: this.formProductName,
          stage: this.formStage,
          priority: this.formPriority,
          progress: progress,
          plannedAt: this.formPlannedAt,
          remark: this.formRemark
        });
        ToastAdapter.success('工单已创建');
      }
      this.orderEditorOpen = false;
      this.orders = WorkOrderStore.workOrders;
      if (this.current) {
        await this.loadResources(this.current.id);
      }
    } catch (err) {
      await this.handleError(err as Error, '工单保存失败');
    }
  }

  async deleteCurrentOrder(): Promise<void> {
    if (!this.current) return;
    try {
      await WorkOrderStore.softDelete(this.current);
      this.orders = WorkOrderStore.workOrders;
      this.current = WorkOrderStore.current;
      this.orderDeleteOpen = false;
      if (this.current) {
        await this.loadResources(this.current.id);
      } else {
        this.categories = [];
        this.files = [];
        this.selectedFile = undefined;
      }
      ToastAdapter.success('工单已软删除');
    } catch (err) {
      await this.handleError(err as Error, '删除工单失败');
    }
  }

  selectedCategoryName(): string {
    for (let i = 0; i < this.categories.length; i++) {
      if (this.categories[i].id === this.selectedCategoryId) {
        return this.categories[i].name;
      }
    }
    return '';
  }

  missingCategoryNames(): string {
    const names: string[] = [];
    for (let i = 0; i < this.categories.length; i++) {
      const category = this.categories[i];
      if (category.required && (category.fileCount || 0) === 0) {
        names.push(category.name);
      }
    }
    if (names.length === 0) return '无';
    return names.join('、');
  }

  missingCategoryCount(): number {
    let count = 0;
    for (let i = 0; i < this.categories.length; i++) {
      if (this.categories[i].required && (this.categories[i].fileCount || 0) === 0) {
        count++;
      }
    }
    return count;
  }

  totalCategoryCount(): number {
    if (this.categories.length > 0) return this.categories.length;
    return 5;
  }

  async logout(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    await AuthStore.logout(context);
    router.replaceUrl({ url: Routes.login });
  }

  async handleError(err: Error, fallback: string): Promise<void> {
    if (err instanceof ApiException && err.needLogin) {
      const context = getContext(this) as common.UIAbilityContext;
      await AuthStore.handleUnauthorized(context);
      return;
    }
    ToastAdapter.error(err.message || fallback);
  }

  errorText(err: Error, fallback: string): string {
    if (err.message && err.message.length > 0) return err.message;
    return fallback;
  }

  addUploadJob(job: UploadQueueItem): void {
    const nextQueue = this.uploadQueue.slice();
    nextQueue.push(job);
    this.uploadQueue = nextQueue;
  }

  updateUploadJob(jobId: string, status: string, message: string): void {
    const nextQueue: UploadQueueItem[] = [];
    this.uploadQueue.forEach((job: UploadQueueItem): void => {
      if (job.id === jobId) {
        const updated: UploadQueueItem = {
          id: job.id,
          name: job.name,
          status: status,
          message: message,
          file: job.file
        };
        nextQueue.push(updated);
      } else {
        nextQueue.push(job);
      }
    });
    this.uploadQueue = nextQueue;
  }

  async uploadPickedFiles(files: PickedFile[]): Promise<void> {
    if (!this.current || !this.selectedCategoryId) {
      ToastAdapter.error('请先选择工单和资料分类');
      return;
    }
    if (!files.length) {
      ToastAdapter.show('已取消选择');
      return;
    }
    for (const file of files) {
      const jobId = `${Date.now()}-${file.name}`;
      const job: UploadQueueItem = {
        id: jobId,
        name: file.name,
        status: '上传中',
        message: '正在上传到对象存储',
        file: file
      };
      this.addUploadJob(job);
      try {
        const uploaded = await ResourceStore.upload(this.current.id, this.selectedCategoryId, file);
        this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
        this.selectedFile = uploaded;
        this.updateUploadJob(jobId, '成功', '上传完成');
      } catch (err) {
        const error = err as Error;
        this.updateUploadJob(jobId, '失败', error.message || '上传失败，可稍后重试');
        await this.handleError(error, '上传失败');
      }
    }
  }

  async uploadPdf(): Promise<void> {
    try {
      await this.uploadPickedFiles(await FilePickerAdapter.pickPdf());
    } catch (err) {
      await this.handleError(err as Error, 'PDF 选择失败');
    }
  }

  async uploadImage(): Promise<void> {
    try {
      await this.uploadPickedFiles(await FilePickerAdapter.pickImages());
    } catch (err) {
      await this.handleError(err as Error, '图片选择失败');
    }
  }

  async cameraUpload(): Promise<void> {
    this.cameraOpen = true;
    if (!CameraAdapter.isSupported()) {
      ToastAdapter.show(CameraAdapter.guidanceText());
      return;
    }
    try {
      await CameraAdapter.openCamera();
      const photo = await CameraAdapter.takePhoto();
      if (photo) {
        this.cameraOpen = false;
        await this.uploadPickedFiles([photo]);
      } else {
        this.cameraOpen = false;
        ToastAdapter.show('已取消选择');
      }
    } catch (err) {
      this.cameraOpen = false;
      await this.handleError(err as Error, '拍照上传失败');
    }
  }

  async capturePhoto(): Promise<void> {
    const photo = await CameraAdapter.takePhoto();
    if (photo) {
      this.cameraOpen = false;
      await this.uploadPickedFiles([photo]);
    } else {
      ToastAdapter.show('未获取到照片，可使用上传图片兜底');
    }
  }

  async downloadFile(file: ResourceFile): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    await DownloadAdapter.downloadFile(file, nativeDownloadUrl(file), context);
  }

  async copyFileLink(file: ResourceFile): Promise<void> {
    await ClipboardAdapter.copyText(`${API_BASE_URL}${file.downloadUrl}`, '文件链接');
  }

  async copyWorkOrderLink(): Promise<void> {
    if (!this.current) return;
    await ClipboardAdapter.copyText(`${API_BASE_URL}/dashboard?workOrderId=${this.current.id}`, '工单链接');
  }

  async openFile(file: ResourceFile): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    await DownloadAdapter.openFile(file, nativeDownloadUrl(file), context);
  }

  async deleteFile(file: ResourceFile): Promise<void> {
    if (!this.current) return;
    try {
      await ResourceStore.deleteSelected(this.current.id, file);
      this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
      this.selectedFile = ResourceStore.selectedFile;
      ToastAdapter.success('文件已软删除');
    } catch (err) {
      await this.handleError(err as Error, '文件删除失败');
    }
  }

  prepareDeleteFile(file: ResourceFile): void {
    this.filePendingDelete = file;
    this.fileDeleteOpen = true;
  }

  async confirmDeleteFile(): Promise<void> {
    if (!this.filePendingDelete) return;
    const file = this.filePendingDelete;
    this.filePendingDelete = undefined;
    this.fileDeleteOpen = false;
    await this.deleteFile(file);
  }

  async saveFileInfo(displayName: string, remark: string, categoryId: string, workOrderId: string): Promise<void> {
    if (!this.current || !this.selectedFile) return;
    try {
      const workOrderIdText = workOrderId.trim();
      const targetWorkOrderId = workOrderIdText.length > 0 ? workOrderIdText : this.current.id;
      const file = await ResourceStore.updateSelected(this.current.id, this.selectedFile, displayName, remark, categoryId, targetWorkOrderId);
      this.categories = ResourceStore.categories;
      this.selectedCategoryId = ResourceStore.currentCategoryId;
      this.files = ResourceStore.filesForCategory(this.selectedCategoryId);
      this.selectedFile = targetWorkOrderId === this.current.id ? file : ResourceStore.selectedFile;
      ToastAdapter.success(targetWorkOrderId === this.current.id ? '文件信息已保存' : '文件已移动到目标工单');
    } catch (err) {
      await this.handleError(err as Error, '文件信息保存失败');
    }
  }

  async downloadAll(): Promise<void> {
    if (!this.current) return;
    const context = getContext(this) as common.UIAbilityContext;
    await DownloadAdapter.downloadPackage(`${this.current.code}-资料包.zip`, downloadAllUrl(this.current.id), context);
  }

  async retryUpload(job: UploadQueueItem): Promise<void> {
    if (!job.file) {
      ToastAdapter.error('缺少可重试文件');
      return;
    }
    await this.uploadPickedFiles([job.file]);
  }

  async retryAllFailedUploads(): Promise<void> {
    const files: PickedFile[] = [];
    for (let i = 0; i < this.uploadQueue.length; i++) {
      const job = this.uploadQueue[i];
      if (job.status === '失败' && job.file) {
        files.push(job.file);
      }
    }
    if (files.length === 0) {
      ToastAdapter.show('暂无可重试的失败上传');
      return;
    }
    await this.uploadPickedFiles(files);
  }

  build(): void {
    Stack() {
      Column() {
        TopBar({
          username: AuthStore.user?.displayName || AuthStore.user?.username || '已登录',
          keyword: this.globalKeyword,
          onKeywordChange: (value: string) => this.globalKeyword = value,
          onSearch: () => this.searchGlobal(),
          onVoiceInput: () => this.voiceInputFallback('全局搜索'),
          onOpenDrawer: () => this.drawerOpen = true,
          onLogout: () => this.logout()
        })
        Column() {
          CurrentWorkOrderBar({
            order: this.current,
            categories: this.categories,
            onSwitchOrder: () => this.drawerOpen = true,
            onCreate: () => this.openCreateOrder(),
            onEdit: () => this.openEditOrder(),
            onDelete: () => this.orderDeleteOpen = true,
            onCopyLink: () => this.copyWorkOrderLink(),
            onDownloadAll: () => this.downloadAll(),
            onCycleStage: () => this.cycleCurrentStage(),
            onCyclePriority: () => this.cycleCurrentPriority(),
            onMore: () => this.toolCollapsed = false
          })
            .margin({ bottom: 14 })
          if (this.loadError.length > 0 || this.resourceError.length > 0) {
            Text(this.loadError.length > 0 ? this.loadError : this.resourceError)
              .fontSize(14)
              .fontColor(Colors.danger)
              .padding({ left: 14, right: 14, top: 8, bottom: 8 })
              .backgroundColor('#FEF2F2')
              .borderRadius(12)
              .margin({ bottom: 12 })
          }
          Stack({ alignContent: Alignment.TopEnd }) {
            if (this.current) {
              Row() {
                ResourceCategoryRail({
                  categories: this.categories,
                  selectedId: this.selectedCategoryId,
                  onSelect: (category: ResourceCategory) => this.selectCategory(category),
                  onOpenUploadManager: () => this.toolCollapsed = false
                })
                Stack({ alignContent: Alignment.Bottom }) {
                  ResourcePreviewPanel({
                    file: this.selectedFile,
                    categoryName: this.selectedCategoryName(),
                    fileCount: this.files.length,
                    missingSummary: this.missingCategoryNames(),
                    onUploadPdf: () => this.uploadPdf(),
                    onUploadImage: () => this.uploadImage(),
                    onCameraUpload: () => this.cameraUpload(),
                    onDownload: (file: ResourceFile) => this.downloadFile(file),
                    onOpen: (file: ResourceFile) => this.openFile(file)
                  })
                  if (this.files.length > 1) {
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
                          .height(56)
                          .width(226)
                          .padding({ left: 12, right: 12, top: 8, bottom: 6 })
                          .backgroundColor(file.id === this.selectedFile?.id ? Colors.primaryLight : '#FDFDFD')
                          .border({ width: 1, color: file.id === this.selectedFile?.id ? Colors.primary : Colors.border })
                          .borderRadius(14)
                          .margin({ right: 10 })
                          .onClick(() => this.selectFile(file))
                        })
                      }
                    }
                    .height(72)
                    .width('92%')
                    .padding({ left: 10, right: 10, top: 8 })
                    .backgroundColor('#EFFFFFFF')
                    .border({ width: 1, color: Colors.border })
                    .borderRadius(18)
                    .margin({ bottom: 16 })
                    .scrollable(ScrollDirection.Horizontal)
                  }
                }
                .layoutWeight(1)
                .height('100%')
                .margin({ left: 12 })
              }
              .height('100%')
            } else {
              Column() {
                Text(this.orders.length === 0 && this.loadError.length === 0 ? '暂无工单' : '暂无选中工单')
                  .fontSize(28)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Colors.text)
                Text(this.loadError.length > 0 ? this.loadError : '登录后会自动选择第一条工单；如果没有显示，请打开左上角工单抽屉。')
                  .fontSize(15)
                  .fontColor(this.loadError.length > 0 ? Colors.danger : Colors.textMuted)
                  .margin({ top: 12, bottom: 20 })
                  .textAlign(TextAlign.Center)
                CommonButton({ label: '打开工单抽屉', onTap: () => this.drawerOpen = true })
              }
              .width('100%')
              .height('100%')
              .justifyContent(FlexAlign.Center)
              .alignItems(HorizontalAlign.Center)
              .backgroundColor(Colors.card)
              .borderRadius(18)
            }
            if (this.current) {
              ResourceToolPanel({
                collapsed: this.toolCollapsed,
                selectedFile: this.selectedFile,
                categories: this.categories,
                selectedCategoryId: this.selectedCategoryId,
                uploadQueue: this.uploadQueue,
                filePickerStatus: FilePickerAdapter.statusText(),
                cameraStatus: CameraAdapter.statusText(),
                onToggle: () => this.toolCollapsed = !this.toolCollapsed,
                onUploadPdf: () => this.uploadPdf(),
                onUploadImage: () => this.uploadImage(),
                onCameraUpload: () => this.cameraUpload(),
                onDownload: (file: ResourceFile) => this.downloadFile(file),
                onOpen: (file: ResourceFile) => this.openFile(file),
                onDelete: (file: ResourceFile) => this.prepareDeleteFile(file),
                onCopyFileLink: (file: ResourceFile) => this.copyFileLink(file),
                onDownloadAll: () => this.downloadAll(),
                onSaveFile: (displayName: string, remark: string, categoryId: string, workOrderId: string) => this.saveFileInfo(displayName, remark, categoryId, workOrderId),
                onRetryUpload: (job: UploadQueueItem) => this.retryUpload(job),
                onRetryAllFailed: () => this.retryAllFailedUploads(),
                onVoiceInput: (targetName: string) => this.voiceInputFallback(targetName)
              })
              .margin({ top: 12, right: 12, bottom: 12 })
            }
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
        Text('加载中')
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
        stageFilter: this.orderStageFilter,
        onClose: () => this.drawerOpen = false,
        onSelect: (order: WorkOrder) => this.selectOrder(order),
        onSearch: (keyword: string) => this.searchOrders(keyword),
        onStageFilter: (stage: string) => this.setOrderStageFilter(stage),
        onVoiceSearch: () => this.voiceInputFallback('工单搜索')
      })
      if (this.searchOpen) {
        Column() {
          Row() {
            Text('全局搜索结果')
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
            Blank()
            Button('关闭')
              .height(38)
              .fontSize(13)
              .fontColor(Colors.primary)
              .backgroundColor(Colors.primaryLight)
              .borderRadius(10)
              .onClick(() => this.searchOpen = false)
          }
          Text(this.searchLoading ? '搜索中' : `工单 ${this.searchWorkOrders.length} · 文件 ${this.searchFiles.length}`)
            .fontSize(14)
            .fontColor(Colors.textMuted)
            .margin({ top: 8, bottom: 12 })
          Scroll() {
            Column() {
              Text('工单')
                .fontSize(16)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
              ForEach(this.searchWorkOrders, (order: WorkOrder) => {
                Row() {
                  Column() {
                    Text(order.code)
                      .fontSize(15)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(Colors.text)
                    Text(`${order.customerName || '未填客户'} · ${order.productName || '-'}`)
                      .fontSize(12)
                      .fontColor(Colors.textMuted)
                      .margin({ top: 4 })
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Button('进入')
                    .height(32)
                    .fontSize(12)
                    .fontColor(Colors.primary)
                    .backgroundColor(Colors.primaryLight)
                    .borderRadius(9)
                    .onClick(() => this.selectSearchOrder(order))
                }
                .padding(10)
                .margin({ top: 8 })
                .backgroundColor('#F9FAFB')
                .borderRadius(12)
              })
              Text('文件')
                .fontSize(16)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
                .margin({ top: 16 })
              ForEach(this.searchFiles, (file: ResourceFile) => {
                Row() {
                  Column() {
                    Text(file.displayName || file.originalName)
                      .fontSize(15)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(Colors.text)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(`${file.categoryName || '-'} · ${file.version || 'V1.0'}`)
                      .fontSize(12)
                      .fontColor(Colors.textMuted)
                      .margin({ top: 4 })
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Button('定位')
                    .height(32)
                    .fontSize(12)
                    .fontColor(Colors.primary)
                    .backgroundColor(Colors.primaryLight)
                    .borderRadius(9)
                    .onClick(() => this.selectSearchFile(file))
                }
                .padding(10)
                .margin({ top: 8 })
                .backgroundColor('#F9FAFB')
                .borderRadius(12)
              })
            }
          }
          .height(410)
        }
        .width(560)
        .padding(22)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
      if (this.orderEditorOpen) {
        Column() {
          Text(this.editingOrderId.length > 0 ? '编辑工单' : '新建工单')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
          Row() {
            TextInput({ placeholder: '工单号', text: this.formCode })
              .height(44)
              .layoutWeight(1)
              .onChange(value => this.formCode = value)
            TextInput({ placeholder: '客户名称', text: this.formCustomerName })
              .height(44)
              .layoutWeight(1)
              .margin({ left: 10 })
              .onChange(value => this.formCustomerName = value)
          }
          .margin({ top: 16 })
          TextInput({ placeholder: '产品名称', text: this.formProductName })
            .height(44)
            .margin({ top: 10 })
            .onChange(value => this.formProductName = value)
          Row() {
            ForEach(this.stageOptions(), (stage: string) => {
              Button(stageLabel(stage))
                .height(38)
                .fontSize(13)
                .fontColor(this.formStage === stage ? Color.White : Colors.text)
                .backgroundColor(this.formStage === stage ? Colors.primary : Colors.card)
                .border({ width: 1, color: this.formStage === stage ? Colors.primary : Colors.border })
                .borderRadius(12)
                .margin({ right: 8 })
                .onClick(() => this.setFormStage(stage))
            })
          }
          .margin({ top: 12 })
          Row() {
            ForEach(this.priorityOptions(), (priority: string) => {
              Button(priorityLabel(priority))
                .height(38)
                .fontSize(13)
                .fontColor(this.formPriority === priority ? Color.White : Colors.text)
                .backgroundColor(this.formPriority === priority ? Colors.primary : Colors.card)
                .border({ width: 1, color: this.formPriority === priority ? Colors.primary : Colors.border })
                .borderRadius(12)
                .margin({ right: 8 })
                .onClick(() => this.setFormPriority(priority))
            })
            TextInput({ placeholder: '进度 0-100', text: this.formProgress })
              .height(38)
              .layoutWeight(1)
              .onChange(value => this.formProgress = value)
          }
          .margin({ top: 12 })
          TextInput({ placeholder: '计划时间，例如 2026-07-05 09:00', text: this.formPlannedAt })
            .height(44)
            .margin({ top: 10 })
            .onChange(value => this.formPlannedAt = value)
          TextInput({ placeholder: '备注', text: this.formRemark })
            .height(70)
            .margin({ top: 10 })
            .onChange(value => this.formRemark = value)
          Button('语音填写备注')
            .height(34)
            .fontSize(13)
            .fontColor(Colors.primary)
            .backgroundColor(Colors.primaryLight)
            .borderRadius(10)
            .margin({ top: 10, bottom: 18 })
            .onClick(() => this.voiceInputFallback('工单备注'))
          Row() {
            CommonButton({ label: '保存工单', onTap: () => this.saveOrder() })
              .margin({ right: 12 })
            CommonButton({ label: '取消', primary: false, onTap: () => this.orderEditorOpen = false })
          }
        }
        .width(620)
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
      if (this.orderDeleteOpen) {
        Column() {
          Text('确认删除工单')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.danger)
          Text(this.current ? `将软删除工单 ${this.current.code}，不会删除对象存储文件。` : '请先选择工单')
            .fontSize(15)
            .fontColor(Colors.textMuted)
            .textAlign(TextAlign.Center)
            .margin({ top: 12, bottom: 20 })
          Row() {
            CommonButton({ label: '确认删除', danger: true, onTap: () => this.deleteCurrentOrder() })
              .margin({ right: 12 })
            CommonButton({ label: '取消', primary: false, onTap: () => this.orderDeleteOpen = false })
          }
        }
        .width(460)
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
      if (this.fileDeleteOpen) {
        Column() {
          Text('确认删除文件')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.danger)
          Text(this.filePendingDelete ? `将软删除文件 ${this.filePendingDelete.displayName || this.filePendingDelete.originalName}，不会物理删除对象存储文件。` : '请先选择文件')
            .fontSize(15)
            .fontColor(Colors.textMuted)
            .textAlign(TextAlign.Center)
            .margin({ top: 12, bottom: 20 })
          Row() {
            CommonButton({ label: '确认删除', danger: true, onTap: () => this.confirmDeleteFile() })
              .margin({ right: 12 })
            CommonButton({ label: '取消', primary: false, onTap: () => { this.filePendingDelete = undefined; this.fileDeleteOpen = false; } })
          }
        }
        .width(460)
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
      if (this.cameraOpen) {
        Column() {
          Text('拍照上传')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
          Text(CameraAdapter.guidanceText())
            .fontSize(15)
            .fontColor(Colors.textMuted)
            .textAlign(TextAlign.Center)
            .margin({ top: 14, bottom: 20 })
          Row() {
            CommonButton({ label: '拍照', isEnabled: CameraAdapter.isSupported(), onTap: () => this.capturePhoto() })
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
