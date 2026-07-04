import { Colors } from '../constants/colors';

@Component
export struct EmptyResourceState {
  title: string = '当前分类暂无资料';
  subtitle: string = '可通过右侧工具窗上传 PDF、图片或拍照资料。';

  build(): void {
    Column() {
      Text('＋')
        .fontSize(38)
        .fontWeight(FontWeight.Bold)
        .fontColor(Color.White)
        .textAlign(TextAlign.Center)
        .width(76)
        .height(76)
        .backgroundColor(Colors.primary)
        .borderRadius(38)
      Text('资料缺失')
        .fontSize(30)
        .fontWeight(FontWeight.Bold)
        .fontColor(Colors.text)
        .margin({ top: 18 })
      Text(this.title)
        .fontSize(18)
        .fontColor(Colors.text)
        .margin({ top: 10 })
      Text(this.subtitle)
        .fontSize(15)
        .fontColor(Colors.textMuted)
        .margin({ top: 8 })
        .textAlign(TextAlign.Center)
        .maxLines(2)
      Row() {
        Text('建议')
          .fontSize(12)
          .fontColor(Colors.primary)
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .backgroundColor(Colors.primaryLight)
          .borderRadius(12)
        Text('原图、SOP指导书、成品图是主要生产资料')
          .fontSize(13)
          .fontColor(Colors.textMuted)
          .margin({ left: 10 })
      }
      .margin({ top: 18 })
      .padding({ left: 14, right: 14, top: 10, bottom: 10 })
      .backgroundColor('#FFFDFB')
      .border({ width: 1, color: Colors.border })
      .borderRadius(16)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
    .padding({ left: 28, right: 28 })
    .backgroundColor(Colors.card)
    .borderRadius(18)
    .shadow({ radius: 18, color: '#10000000', offsetY: 6 })
  }
}
