import { Colors } from '../constants/colors';
import type { ResourceCategory } from '../models/ResourceCategory';
import type { ResourceFile } from '../models/ResourceFile';
import { displayName, fileSizeText } from '../utils/format';
import { CommonButton } from './CommonButton';

export interface UploadQueueItem {
  id: string;
  name: string;
  status: string;
  message: string;
}

@Component
export struct ResourceToolPanel {
  collapsed: boolean = false;
  selectedFile?: ResourceFile;
  categories: ResourceCategory[] = [];
  selectedCategoryId: string = '';
  uploadQueue: UploadQueueItem[] = [];
  filePickerStatus: string = '请使用 Web 端';
  cameraStatus: string = '请使用上传图片';
  onToggle: () => void = () => {};
  onUploadPdf: () => void = () => {};
  onUploadImage: () => void = () => {};
  onCameraUpload: () => void = () => {};
  onDownload: (file: ResourceFile) => void = () => {};
  onOpen: (file: ResourceFile) => void = () => {};
  onDelete: (file: ResourceFile) => void = () => {};
  onDownloadAll: () => void = () => {};
  onSaveFile: (displayName: string, remark: string, categoryId: string) => void = () => {};
  @State activeTab: string = 'upload';
  @State editDisplayName: string = '';
  @State editRemark: string = '';
  @State editCategoryId: string = '';

  openTab(tab: string): void {
    this.activeTab = tab;
    if (this.collapsed) {
      this.onToggle();
    }
  }

  tabBg(tab: string): string {
    return this.activeTab === tab && !this.collapsed ? Colors.primary : Colors.card;
  }

  beginEdit(): void {
    if (!this.selectedFile) return;
    this.editDisplayName = this.selectedFile.displayName || this.selectedFile.originalName;
    this.editRemark = this.selectedFile.remark || '';
    this.editCategoryId = this.selectedFile.categoryId || this.selectedCategoryId;
    this.openTab('edit');
  }

  build(): void {
    Row() {
      Column() {
        Button('信息')
          .height(42)
          .width('100%')
          .fontSize(13)
          .fontColor(this.activeTab === 'info' && !this.collapsed ? Color.White : Colors.text)
          .backgroundColor(this.tabBg('info'))
          .border({ width: 1, color: this.activeTab === 'info' && !this.collapsed ? Colors.primary : Colors.border })
          .borderRadius(12)
          .margin({ bottom: 8 })
          .onClick(() => this.openTab('info'))
        Button('上传')
          .height(42)
          .width('100%')
          .fontSize(13)
          .fontColor(this.activeTab === 'upload' && !this.collapsed ? Color.White : Colors.text)
          .backgroundColor(this.tabBg('upload'))
          .border({ width: 1, color: this.activeTab === 'upload' && !this.collapsed ? Colors.primary : Colors.border })
          .borderRadius(12)
          .margin({ bottom: 8 })
          .onClick(() => this.openTab('upload'))
        Button('操作')
          .height(42)
          .width('100%')
          .fontSize(13)
          .fontColor(this.activeTab === 'actions' && !this.collapsed ? Color.White : Colors.text)
          .backgroundColor(this.tabBg('actions'))
          .border({ width: 1, color: this.activeTab === 'actions' && !this.collapsed ? Colors.primary : Colors.border })
          .borderRadius(12)
          .margin({ bottom: 8 })
          .onClick(() => this.openTab('actions'))
        Button('编辑')
          .height(42)
          .width('100%')
          .fontSize(13)
          .fontColor(this.activeTab === 'edit' && !this.collapsed ? Color.White : Colors.text)
          .backgroundColor(this.tabBg('edit'))
          .border({ width: 1, color: this.activeTab === 'edit' && !this.collapsed ? Colors.primary : Colors.border })
          .borderRadius(12)
          .margin({ bottom: 8 })
          .onClick(() => this.beginEdit())
        Button('队列')
          .height(42)
          .width('100%')
          .fontSize(13)
          .fontColor(this.activeTab === 'queue' && !this.collapsed ? Color.White : Colors.text)
          .backgroundColor(this.tabBg('queue'))
          .border({ width: 1, color: this.activeTab === 'queue' && !this.collapsed ? Colors.primary : Colors.border })
          .borderRadius(12)
          .margin({ bottom: 8 })
          .onClick(() => this.openTab('queue'))
        Blank()
        Button(this.collapsed ? '展开' : '收起')
          .height(38)
          .width('100%')
          .fontSize(12)
          .fontColor(this.collapsed ? Color.White : Colors.primary)
          .backgroundColor(this.collapsed ? Colors.primary : Colors.primaryLight)
          .borderRadius(12)
          .onClick(() => this.onToggle())
      }
      .width(74)
      .height('100%')
      .padding(10)
      .backgroundColor(Colors.card)
      .border({ width: 1, color: Colors.border })
      .borderRadius(18)
      .shadow({ radius: 18, color: '#1A000000', offsetY: 6 })

      if (!this.collapsed) {
        Column() {
          Row() {
            Column() {
              Text(this.activeTab === 'info' ? '文件信息' : this.activeTab === 'upload' ? '上传资料' : this.activeTab === 'actions' ? '文件操作' : this.activeTab === 'edit' ? '编辑资料' : '上传队列')
                .fontSize(19)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
              Text('右侧工具窗覆盖展开，不挤压预览')
                .fontSize(12)
                .fontColor(Colors.textMuted)
                .margin({ top: 4 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            Button('×')
              .height(34)
              .width(40)
              .fontSize(18)
              .backgroundColor(Colors.primaryLight)
              .fontColor(Colors.primary)
              .borderRadius(10)
              .onClick(() => this.onToggle())
          }
          .margin({ bottom: 14 })

          if (this.activeTab === 'upload') {
            Column() {
              Row() {
                Text('文件选择')
                  .fontSize(12)
                  .fontColor(Colors.textMuted)
                Blank()
                Text(this.filePickerStatus)
                  .fontSize(12)
                  .fontColor(this.filePickerStatus === '可用' ? Colors.success : Colors.primary)
              }
              .margin({ bottom: 8 })
              Row() {
                Text('相机')
                  .fontSize(12)
                  .fontColor(Colors.textMuted)
                Blank()
                Text(this.cameraStatus)
                  .fontSize(12)
                  .fontColor(this.cameraStatus === '可用' ? Colors.success : Colors.primary)
              }
              .margin({ bottom: 12 })
              CommonButton({ label: '上传 PDF', onTap: this.onUploadPdf })
                .width('100%')
              CommonButton({ label: '上传图片', onTap: this.onUploadImage })
                .width('100%')
                .margin({ top: 10 })
              CommonButton({ label: '拍照上传', primary: false, onTap: this.onCameraUpload })
                .width('100%')
                .margin({ top: 10 })
              Text('文件保存到 S3 兼容对象存储，元数据写入 PostgreSQL。')
                .fontSize(12)
                .fontColor(Colors.textMuted)
                .margin({ top: 12 })
              Text('当前设备不支持原生选择器时，请使用 Web 端上传。')
                .fontSize(12)
                .fontColor(Colors.textMuted)
                .margin({ top: 8 })
            }
            .padding(14)
            .backgroundColor('#F9FAFB')
            .borderRadius(14)
          }

          if (this.activeTab === 'info') {
            Column() {
              if (this.selectedFile) {
                Text(displayName(this.selectedFile.displayName, this.selectedFile.originalName))
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(Colors.text)
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${this.selectedFile.version || 'V1.0'} · ${fileSizeText(this.selectedFile.fileSize)}`)
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 8 })
                Text(`分类：${this.selectedFile.categoryName || '-'}`)
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 8 })
                Text(`上传人：${this.selectedFile.uploadedBy || '-'}`)
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 8 })
              } else {
                Text('当前分类暂无选中文件')
                  .fontSize(14)
                  .fontColor(Colors.textMuted)
              }
            }
            .padding(14)
            .backgroundColor('#F9FAFB')
            .borderRadius(14)
          }

          if (this.activeTab === 'actions') {
            Column() {
              if (this.selectedFile) {
                CommonButton({ label: '下载', primary: false, onTap: () => this.onDownload(this.selectedFile as ResourceFile) })
                  .width('100%')
                CommonButton({ label: '打开', primary: false, onTap: () => this.onOpen(this.selectedFile as ResourceFile) })
                  .width('100%')
                  .margin({ top: 10 })
                CommonButton({ label: '下载全部资料包', onTap: this.onDownloadAll })
                  .width('100%')
                  .margin({ top: 10 })
                CommonButton({ label: '编辑 / 移动', primary: false, onTap: () => this.beginEdit() })
                  .width('100%')
                  .margin({ top: 10 })
                CommonButton({ label: '删除文件', danger: true, onTap: () => this.onDelete(this.selectedFile as ResourceFile) })
                  .width('100%')
                  .margin({ top: 10 })
                Text('删除为软删除，对象存储文件不会被物理移除。')
                  .fontSize(12)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 12 })
              } else {
                Text('没有可操作文件')
                  .fontSize(14)
                  .fontColor(Colors.textMuted)
              }
            }
            .padding(14)
            .backgroundColor('#F9FAFB')
            .borderRadius(14)
          }

          if (this.activeTab === 'edit') {
            Column() {
              if (this.selectedFile) {
                TextInput({ placeholder: '显示文件名', text: this.editDisplayName })
                  .height(44)
                  .onChange(value => this.editDisplayName = value)
                TextInput({ placeholder: '备注', text: this.editRemark })
                  .height(64)
                  .margin({ top: 10 })
                  .onChange(value => this.editRemark = value)
                Text('移动到分类')
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 12, bottom: 8 })
                Scroll() {
                  Column() {
                    ForEach(this.categories, (category: ResourceCategory) => {
                      Button(category.name)
                        .height(36)
                        .width('100%')
                        .fontSize(13)
                        .fontColor(this.editCategoryId === category.id ? Color.White : Colors.text)
                        .backgroundColor(this.editCategoryId === category.id ? Colors.primary : Colors.card)
                        .border({ width: 1, color: this.editCategoryId === category.id ? Colors.primary : Colors.border })
                        .borderRadius(10)
                        .margin({ bottom: 8 })
                        .onClick(() => this.editCategoryId = category.id)
                    })
                  }
                }
                .height(176)
                CommonButton({ label: '保存文件信息', onTap: () => this.onSaveFile(this.editDisplayName, this.editRemark, this.editCategoryId) })
                  .width('100%')
                  .margin({ top: 12 })
              } else {
                Text('请先选择一个文件')
                  .fontSize(14)
                  .fontColor(Colors.textMuted)
              }
            }
            .padding(14)
            .backgroundColor('#F9FAFB')
            .borderRadius(14)
          }

          if (this.activeTab === 'queue') {
            Column() {
              if (this.uploadQueue.length === 0) {
                Text('暂无上传任务')
                  .fontSize(14)
                  .fontColor(Colors.textMuted)
              }
              ForEach(this.uploadQueue, (job: UploadQueueItem) => {
                Column() {
                  Text(job.name)
                    .fontSize(13)
                    .fontColor(Colors.text)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(`${job.status} · ${job.message}`)
                    .fontSize(12)
                    .fontColor(job.status === '失败' ? Colors.danger : Colors.textMuted)
                    .margin({ top: 4 })
                }
                .width('100%')
                .padding(10)
                .margin({ bottom: 8 })
                .backgroundColor('#FFFDFB')
                .border({ width: 1, color: Colors.border })
                .borderRadius(12)
              })
            }
            .padding(14)
            .backgroundColor('#F9FAFB')
            .borderRadius(14)
          }
        }
        .width(294)
        .height('100%')
        .padding(16)
        .margin({ left: 10 })
        .backgroundColor(Colors.card)
        .border({ width: 1, color: Colors.border })
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
    }
    .height('100%')
  }
}
