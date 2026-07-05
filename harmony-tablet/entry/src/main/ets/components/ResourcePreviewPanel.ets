import { Colors } from '../constants/colors';
import type { ResourceFile } from '../models/ResourceFile';
import { nativeContentUrl } from '../services/resourceApi';
import { displayName, fileSizeText } from '../utils/format';
import { isImageType, isPdfType } from '../utils/validators';
import { CommonButton } from './CommonButton';

@Component
export struct ResourcePreviewPanel {
  file?: ResourceFile;
  categoryName: string = '';
  fileCount: number = 0;
  missingSummary: string = '无';
  onUploadPdf: () => void = () => {};
  onUploadImage: () => void = () => {};
  onCameraUpload: () => void = () => {};
  onDownload: (file: ResourceFile) => void = () => {};
  onOpen: (file: ResourceFile) => void = () => {};

  build(): void {
    Row() {
      Column() {
        Text(this.fileCount > 0 ? '当前分类资料' : '当前分类暂无文件')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text('上传后所有登录账号都可共享查看')
          .fontSize(13)
          .fontColor(Colors.textMuted)
          .margin({ top: 6 })
        Column() {
          Row() {
            Text('当前分类')
              .fontSize(12)
              .fontColor(Colors.textMuted)
            Blank()
            Text(this.categoryName || '-')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(Colors.text)
          }
          Row() {
            Text('支持格式')
              .fontSize(12)
              .fontColor(Colors.textMuted)
            Blank()
            Text('PDF / JPG / PNG')
              .fontSize(13)
              .fontColor(Colors.text)
          }
          .margin({ top: 10 })
          Row() {
            Text('文件数量')
              .fontSize(12)
              .fontColor(Colors.textMuted)
            Blank()
            Text(`${this.fileCount} 个`)
              .fontSize(13)
              .fontColor(this.fileCount > 0 ? Colors.success : Colors.primary)
          }
          .margin({ top: 10 })
        }
        .padding(14)
        .margin({ top: 16 })
        .backgroundColor('#F9FAFB')
        .borderRadius(16)

        Column() {
          Text('建议')
            .fontSize(14)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
          Text('原图、SOP指导书、成品图为主要生产资料。')
            .fontSize(13)
            .fontColor(Colors.textMuted)
            .margin({ top: 8 })
          Text(`当前工单缺失：${this.missingSummary}`)
            .fontSize(13)
            .fontColor(this.missingSummary === '无' ? Colors.success : Colors.primary)
            .margin({ top: 8 })
        }
        .padding(14)
        .margin({ top: 12 })
        .backgroundColor('#FFFDFB')
        .border({ width: 1, color: Colors.border })
        .borderRadius(16)

        CommonButton({ label: '上传 PDF', onTap: this.onUploadPdf })
          .width('100%')
          .margin({ top: 16 })
        CommonButton({ label: '上传图片', onTap: this.onUploadImage })
          .width('100%')
          .margin({ top: 10 })
        CommonButton({ label: '拍照上传', primary: false, onTap: this.onCameraUpload })
          .width('100%')
          .margin({ top: 10 })
      }
      .width(286)
      .height('100%')
      .padding(18)
      .backgroundColor(Colors.card)
      .borderRadius(18)
      .shadow({ radius: 16, color: '#10000000', offsetY: 5 })

      Column() {
        if (!this.file) {
          Column() {
            Text('当前分类暂无资料')
              .fontSize(26)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
            Text('当前分类暂无文件。请从左侧说明卡或右侧工具栏上传资料。')
              .fontSize(15)
              .fontColor(Colors.textMuted)
              .textAlign(TextAlign.Center)
              .margin({ top: 12 })
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
          .backgroundColor('#F8FAFC')
          .border({ width: 1, color: Colors.border })
          .borderRadius(18)
        } else if (isImageType(this.file.fileType, this.file.mimeType)) {
          Column() {
            Row() {
              Column() {
                Text(displayName(this.file.displayName, this.file.originalName))
                  .fontSize(18)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Colors.text)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(`${this.categoryName || '资料'} · 共 ${this.fileCount} 个 · ${this.file.version || 'V1.0'} · ${fileSizeText(this.file.fileSize)}`)
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 5 })
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text('图片预览')
                .fontSize(13)
                .fontColor(Colors.primary)
                .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .backgroundColor(Colors.primaryLight)
                .borderRadius(14)
            }
            .margin({ bottom: 12 })
            Image(nativeContentUrl(this.file))
              .objectFit(ImageFit.Contain)
              .width('100%')
              .layoutWeight(1)
              .backgroundColor('#F8FAFC')
              .borderRadius(16)
              .border({ width: 1, color: Colors.border })
            Row() {
              CommonButton({ label: '下载', primary: false, onTap: () => this.onDownload(this.file as ResourceFile) })
                .margin({ right: 12 })
              CommonButton({ label: '打开', primary: false, onTap: () => this.onOpen(this.file as ResourceFile) })
            }
            .justifyContent(FlexAlign.Center)
            .margin({ top: 12 })
          }
          .width('100%')
          .height('100%')
        } else if (isPdfType(this.file.fileType, this.file.mimeType)) {
          Column() {
            Text('PDF')
              .fontSize(36)
              .fontWeight(FontWeight.Bold)
              .fontColor(Color.White)
              .textAlign(TextAlign.Center)
              .width(92)
              .height(92)
              .backgroundColor(Colors.primary)
              .borderRadius(24)
            Text(displayName(this.file.displayName, this.file.originalName))
              .fontSize(18)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
              .margin({ top: 18 })
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(`${this.categoryName || 'PDF资料'} · 共 ${this.fileCount} 个 · ${this.file.version || 'V1.0'} · ${fileSizeText(this.file.fileSize)}`)
              .fontSize(14)
              .fontColor(Colors.textMuted)
              .margin({ top: 10 })
            Text(`上传时间：${this.file.createdAt || '-'}`)
              .fontSize(14)
              .fontColor(Colors.textMuted)
              .margin({ top: 8 })
            Text('当前原生版本以 PDF 文件卡片承载，支持下载 / 打开入口。')
              .fontSize(14)
              .fontColor(Colors.textMuted)
              .margin({ top: 18 })
              .textAlign(TextAlign.Center)
            Row() {
              CommonButton({ label: '下载', onTap: () => this.onDownload(this.file as ResourceFile) })
                .margin({ right: 12 })
              CommonButton({ label: '打开', primary: false, onTap: () => this.onOpen(this.file as ResourceFile) })
            }
            .justifyContent(FlexAlign.Center)
            .margin({ top: 22 })
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
        } else {
          Column() {
            Text('当前文件类型无法在平板内预览')
              .fontSize(22)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
            Text(displayName(this.file.displayName, this.file.originalName))
              .fontSize(14)
              .fontColor(Colors.textMuted)
              .margin({ top: 10 })
            Text('请使用右侧工具窗下载或打开查看。')
              .fontSize(14)
              .fontColor(Colors.textMuted)
              .margin({ top: 8 })
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)
        }
      }
      .layoutWeight(1)
      .height('100%')
      .padding(18)
      .margin({ left: 12 })
      .backgroundColor(Colors.card)
      .borderRadius(18)
      .shadow({ radius: 18, color: '#10000000', offsetY: 6 })
    }
    .width('100%')
    .height('100%')
  }
}
