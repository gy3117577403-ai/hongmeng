import { Colors } from '../constants/colors';
import type { ResourceFile } from '../models/ResourceFile';
import { nativeContentUrl } from '../services/resourceApi';
import { displayName, fileSizeText } from '../utils/format';
import { isImageType, isPdfType } from '../utils/validators';
import { EmptyResourceState } from './EmptyResourceState';

@Component
export struct ResourcePreviewPanel {
  file?: ResourceFile;

  build() {
    Column() {
      if (!this.file) {
        EmptyResourceState()
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
          Text('第一版原生 App 暂以 PDF 文件卡片和打开入口承载，后续可接入原生 PDF 渲染。')
            .fontSize(14)
            .fontColor(Colors.textMuted)
            .margin({ top: 18 })
            .textAlign(TextAlign.Center)
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
