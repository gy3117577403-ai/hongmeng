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
  onUploadPdf: () => void = () => {};
  onUploadImage: () => void = () => {};
  onCameraUpload: () => void = () => {};
  onDownload: (file: ResourceFile) => void = () => {};
  onOpen: (file: ResourceFile) => void = () => {};

  build() {
    Column() {
      if (!this.file) {
        Column() {
          EmptyResourceState()
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
          Text(displayName(this.file.displayName, this.file.originalName))
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
            .margin({ bottom: 12 })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Image(nativeContentUrl(this.file))
            .objectFit(ImageFit.Contain)
            .width('100%')
            .layoutWeight(1)
            .backgroundColor('#F9FAFB')
            .borderRadius(16)
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
      } else if (isPdfType(this.file.fileType, this.file.mimeType)) {
        Column() {
          Text('PDF 资料')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.primary)
          Text(displayName(this.file.displayName, this.file.originalName))
            .fontSize(18)
            .fontColor(Colors.text)
            .margin({ top: 16 })
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(`${this.file.version || 'V1.0'} · ${fileSizeText(this.file.fileSize)}`)
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
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
      } else {
        EmptyResourceState({ title: '暂不支持该文件类型预览', subtitle: displayName(this.file.displayName, this.file.originalName) })
      }
    }
    .width('100%')
    .height('100%')
  }
}
