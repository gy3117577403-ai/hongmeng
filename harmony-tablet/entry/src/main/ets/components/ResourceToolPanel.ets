import { Colors } from '../constants/colors';
import type { ResourceFile } from '../models/ResourceFile';
import { nativeDownloadUrl } from '../services/resourceApi';
import { displayName, fileSizeText } from '../utils/format';
import { CommonButton } from './CommonButton';

@Component
export struct ResourceToolPanel {
  collapsed: boolean = false;
  selectedFile?: ResourceFile;
  onToggle: () => void = () => {};
  onUploadPdf: () => void = () => {};
  onUploadImage: () => void = () => {};
  onCameraUpload: () => void = () => {};

  build() {
    Column() {
      Row() {
        Text(this.collapsed ? '工具' : '资料工具')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Blank()
        Button(this.collapsed ? '展开' : '收起')
          .height(36)
          .fontSize(13)
          .backgroundColor(Colors.primaryLight)
          .fontColor(Colors.primary)
          .borderRadius(10)
          .onClick(() => this.onToggle())
      }
      if (!this.collapsed) {
        Column() {
          CommonButton({ label: '上传 PDF', onTap: this.onUploadPdf })
          CommonButton({ label: '上传图片', onTap: this.onUploadImage })
            .margin({ top: 10 })
          CommonButton({ label: '拍照上传', primary: false, onTap: this.onCameraUpload })
            .margin({ top: 10 })
        }
        .margin({ top: 16 })
        if (this.selectedFile) {
          Column() {
            Text('当前文件')
              .fontSize(15)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
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
            Text(`下载地址：${nativeDownloadUrl(this.selectedFile)}`)
              .fontSize(12)
              .fontColor(Colors.textMuted)
              .margin({ top: 10 })
              .maxLines(3)
          }
          .padding(14)
          .margin({ top: 18 })
          .backgroundColor('#F9FAFB')
          .borderRadius(14)
        }
      }
    }
    .width(this.collapsed ? 86 : 292)
    .height('100%')
    .padding(16)
    .backgroundColor(Colors.card)
    .borderRadius(18)
  }
}
