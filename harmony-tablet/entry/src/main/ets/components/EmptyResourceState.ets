import { Colors } from '../constants/colors';

@Component
export struct EmptyResourceState {
  title: string = '当前分类暂无资料';
  subtitle: string = '可通过右侧工具窗上传 PDF、图片或拍照资料。';

  build(): void {
    Column() {
      Text('资料缺失')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)
        .fontColor(Colors.primary)
      Text(this.title)
        .fontSize(18)
        .fontColor(Colors.text)
        .margin({ top: 14 })
      Text(this.subtitle)
        .fontSize(14)
        .fontColor(Colors.textMuted)
        .margin({ top: 8 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor(Colors.card)
    .borderRadius(18)
  }
}
