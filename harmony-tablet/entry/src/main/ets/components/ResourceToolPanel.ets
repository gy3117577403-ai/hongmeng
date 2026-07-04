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

  build(): void {
    if (this.collapsed) {
      Column() {
        Button('展开')
          .height(38)
          .width('100%')
          .fontSize(13)
          .fontColor(Color.White)
          .backgroundColor(Colors.primary)
          .borderRadius(12)
          .onClick(() => this.onToggle())
        Text('上传')
          .fontSize(12)
          .fontColor(Colors.textMuted)
          .margin({ top: 16 })
        Text('信息')
          .fontSize(12)
          .fontColor(Colors.textMuted)
          .margin({ top: 14 })
        Text('操作')
          .fontSize(12)
          .fontColor(Colors.textMuted)
          .margin({ top: 14 })
      }
      .width(86)
      .padding(12)
      .backgroundColor(Colors.card)
      .border({ width: 1, color: Colors.border })
      .borderRadius(18)
      .shadow({ radius: 20, color: '#1A000000', offsetY: 6 })
    } else {
      Column() {
        Row() {
          Column() {
            Text('资料工具')
              .fontSize(19)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
            Text('上传、信息、下载与删除')
              .fontSize(12)
              .fontColor(Colors.textMuted)
              .margin({ top: 4 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Button('收起')
            .height(36)
            .fontSize(13)
            .backgroundColor(Colors.primaryLight)
            .fontColor(Colors.primary)
            .borderRadius(10)
            .onClick(() => this.onToggle())
        }
        Scroll() {
          Column() {
            Column() {
              Text('上传资料')
                .fontSize(15)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
              CommonButton({ label: '上传 PDF', onTap: this.onUploadPdf })
                .width('100%')
                .margin({ top: 12 })
              CommonButton({ label: '上传图片', onTap: this.onUploadImage })
                .width('100%')
                .margin({ top: 10 })
              CommonButton({ label: '拍照上传', primary: false, onTap: this.onCameraUpload })
                .width('100%')
                .margin({ top: 10 })
              Text('文件保存到 S3 兼容对象存储，元数据写入 PostgreSQL。')
                .fontSize(12)
                .fontColor(Colors.textMuted)
                .margin({ top: 10 })
            }
            .padding(14)
            .margin({ top: 16 })
            .backgroundColor('#F9FAFB')
            .borderRadius(14)

            Column() {
              Text('文件信息')
                .fontSize(15)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
              if (this.selectedFile) {
                Text(displayName(this.selectedFile.displayName, this.selectedFile.originalName))
                  .fontSize(14)
                  .fontColor(Colors.text)
                  .margin({ top: 8 })
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${this.selectedFile.version || 'V1.0'} · ${fileSizeText(this.selectedFile.fileSize)}`)
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 6 })
                Text(`分类：${this.selectedFile.categoryName || '-'}`)
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 6 })
              } else {
                Text('当前分类暂无选中文件')
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 10 })
              }
            }
            .padding(14)
            .margin({ top: 14 })
            .backgroundColor('#F9FAFB')
            .borderRadius(14)

            Column() {
              Text('文件操作')
                .fontSize(15)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
              if (this.selectedFile) {
                CommonButton({ label: '下载', primary: false, onTap: () => this.onDownload(this.selectedFile as ResourceFile) })
                  .width('100%')
                  .margin({ top: 12 })
                CommonButton({ label: '打开', primary: false, onTap: () => this.onOpen(this.selectedFile as ResourceFile) })
                  .width('100%')
                  .margin({ top: 10 })
                CommonButton({ label: '删除文件', danger: true, onTap: () => this.onDelete(this.selectedFile as ResourceFile) })
                  .width('100%')
                  .margin({ top: 10 })
                Text('移动文件：后续原生编辑能力补齐后开放。')
                  .fontSize(12)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 10 })
              } else {
                Text('没有可操作文件')
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 10 })
              }
            }
            .padding(14)
            .margin({ top: 14 })
            .backgroundColor('#F9FAFB')
            .borderRadius(14)

            if (this.uploadQueue.length > 0) {
              Column() {
                Text('上传队列')
                  .fontSize(15)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Colors.text)
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
                  .margin({ top: 8 })
                  .backgroundColor('#FFFDFB')
                  .border({ width: 1, color: Colors.border })
                  .borderRadius(12)
                })
              }
              .padding(14)
              .margin({ top: 14, bottom: 8 })
              .backgroundColor('#F9FAFB')
              .borderRadius(14)
            }
          }
        }
        .layoutWeight(1)
      }
      .width(318)
      .height('100%')
      .padding(16)
      .backgroundColor(Colors.card)
      .border({ width: 1, color: Colors.border })
      .borderRadius(18)
      .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
    }
  }
}
