import { Colors } from '../constants/colors';
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
  uploadQueue: UploadQueueItem[] = [];
  onToggle: () => void = () => {};
  onUploadPdf: () => void = () => {};
  onUploadImage: () => void = () => {};
  onCameraUpload: () => void = () => {};
  onDownload: (file: ResourceFile) => void = () => {};
  onOpen: (file: ResourceFile) => void = () => {};
  onDelete: (file: ResourceFile) => void = () => {};
  @State activeTab: string = 'upload';

  openTab(tab: string): void {
    this.activeTab = tab;
    if (this.collapsed) {
      this.onToggle();
    }
  }

  tabBg(tab: string): string {
    return this.activeTab === tab && !this.collapsed ? Colors.primary : Colors.card;
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
              Text(this.activeTab === 'info' ? '文件信息' : this.activeTab === 'upload' ? '上传资料' : this.activeTab === 'actions' ? '文件操作' : '上传队列')
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
                CommonButton({ label: '删除文件', danger: true, onTap: () => this.onDelete(this.selectedFile as ResourceFile) })
                  .width('100%')
                  .margin({ top: 10 })
                Text('移动文件：后续原生编辑能力补齐后开放。')
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
