import router from '@ohos.router';
import { Colors } from '../constants/colors';
import { Routes } from '../constants/routes';

@Component
export struct TopBar {
  username: string = '';
  keyword: string = '';
  onKeywordChange: (value: string) => void = () => {};
  onSearch: () => void = () => {};
  onOpenDrawer: () => void = () => {};
  onPlaceholder: (name: string) => void = () => {};
  onLogout: () => void = () => {};

  build(): void {
    Row() {
      Column() {
        Text('▦')
          .fontSize(20)
          .fontColor(Color.White)
          .textAlign(TextAlign.Center)
      }
      .width(40)
      .height(40)
      .justifyContent(FlexAlign.Center)
      .backgroundColor(Colors.primary)
      .borderRadius(14)
      Column() {
        Text('工单资料库')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text('鸿蒙平板生产资料管理系统')
          .fontSize(12)
          .fontColor(Colors.textMuted)
          .margin({ top: 3 })
      }
      .width(170)
      .margin({ left: 8 })
      .alignItems(HorizontalAlign.Start)

      Row() {
        TextInput({ placeholder: '全局搜索工单 / 文件', text: this.keyword })
          .height(42)
          .layoutWeight(1)
          .fontSize(14)
          .backgroundColor('#F9FAFB')
          .border({ width: 1, color: Colors.border })
          .borderRadius(14)
          .onChange(value => this.onKeywordChange(value))
        Button('搜索')
          .height(42)
          .width(72)
          .fontSize(13)
          .fontColor(Color.White)
          .backgroundColor(Colors.primary)
          .borderRadius(12)
          .margin({ left: 8 })
          .onClick(() => this.onSearch())
      }
      .layoutWeight(1)
      .margin({ left: 10, right: 10 })

      Button('工单')
        .height(44)
        .width(64)
        .fontSize(14)
        .fontColor(Color.White)
        .backgroundColor(Colors.primary)
        .borderRadius(12)
        .onClick(() => this.onOpenDrawer())
      Button('资料库')
        .height(44)
        .width(74)
        .fontSize(13)
        .margin({ left: 6 })
        .backgroundColor(Colors.card)
        .fontColor(Colors.text)
        .border({ width: 1, color: Colors.border })
        .borderRadius(12)
        .onClick(() => this.onOpenDrawer())
      Button('连接器')
        .height(44)
        .width(74)
        .fontSize(13)
        .margin({ left: 6 })
        .backgroundColor(Colors.card)
        .fontColor(Colors.text)
        .border({ width: 1, color: Colors.border })
        .borderRadius(12)
        .onClick(() => router.pushUrl({ url: Routes.connectorParameters }))
      Button('设置')
        .height(44)
        .width(60)
        .fontSize(14)
        .margin({ left: 6 })
        .backgroundColor(Colors.card)
        .fontColor(Colors.text)
        .border({ width: 1, color: Colors.border })
        .borderRadius(12)
        .onClick(() => router.pushUrl({ url: Routes.settings }))
      Column() {
        Text('管理员')
          .fontSize(11)
          .fontColor(Colors.textMuted)
        Text(this.username)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(Colors.text)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width(72)
      .alignItems(HorizontalAlign.End)
      .margin({ left: 6, right: 6 })
      Button('退出')
        .height(44)
        .width(60)
        .fontSize(14)
        .fontColor(Colors.primary)
        .backgroundColor(Colors.primaryLight)
        .borderRadius(12)
        .onClick(() => this.onLogout())
    }
    .height(76)
    .width('100%')
    .padding({ left: 16, right: 16 })
    .backgroundColor(Colors.card)
    .border({ width: { bottom: 1 }, color: Colors.border })
  }
}
