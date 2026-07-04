import { Colors } from '../constants/colors';
import type { ResourceFile } from '../models/ResourceFile';
import { nativeContentUrl } from '../services/resourceApi';
import { displayName, fileSizeText } from '../utils/format';
import { isImageType, isPdfType } from '../utils/validators';
import { EmptyResourceState } from './EmptyResourceState';
import { CommonButton } from './CommonButton';

@Component
export struct ResourcePreviewPanel {
  file?: ResourceFile;
  categoryName: string = '';
  fileCount: number = 0;
  onUploadPdf: () => void = () => {};
  onUploadImage: () => void = () => {};
  onCameraUpload: () => void = () => {};
  onDownload: (file: ResourceFile) => void = () => {};
  onOpen: (file: ResourceFile) => void = () => {};

  build(): void {
    Column() {
      if (!this.file) {
        Column() {
          EmptyResourceState({
            title: `${this.categoryName || '当前分类'}暂无资料`,
            subtitle: '可通过右侧资料工具窗上传 PDF、图片或拍照资料。'
          })
            .layoutWeight(1)
          Row() {
            CommonButton({ label: '上传 PDF', onTap: this.onUploadPdf })
              .margin({ right: 12 })
            CommonButton({ label: '上传图片', onTap: this.onUploadImage })
              .margin({ right: 12 })
            CommonButton({ label: '拍照上传', primary: false, onTap: this.onCameraUpload })
          }
          .justifyContent(FlexAlign.Center)
          .padding({ top: 14 })
        }
        .width('100%')
        .height('100%')
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
        .padding(18)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 18, color: '#10000000', offsetY: 6 })
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
          Text('当前原生版本以 PDF 文件卡片承载，支持下载 / 打开入口，后续可接入原生 PDF 渲染。')
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
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 18, color: '#10000000', offsetY: 6 })
      } else {
        EmptyResourceState({ title: '暂不支持该文件类型预览', subtitle: displayName(this.file.displayName, this.file.originalName) })
      }
    }
    .width('100%')
    .height('100%')
  }
}
