import router from '@ohos.router';
import { Colors } from '../constants/colors';
import { Routes } from '../constants/routes';

@Component
export struct TopBar {
  username: string = '';
  onOpenDrawer: () => void = () => {};
  onLogout: () => void = () => {};

  build(): void {
    Row() {
      Button('工单')
        .height(46)
        .width(92)
        .fontSize(16)
        .fontColor(Color.White)
        .backgroundColor(Colors.primary)
        .borderRadius(14)
        .onClick(() => this.onOpenDrawer())
      Column() {
        Text('工单资料库')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text('鸿蒙平板生产资料管理系统')
          .fontSize(13)
          .fontColor(Colors.textMuted)
          .margin({ top: 3 })
      }
      .margin({ left: 16 })
      .alignItems(HorizontalAlign.Start)
      Blank()
      Button('连接器参数')
        .height(44)
        .width(126)
        .fontSize(15)
        .backgroundColor(Colors.card)
        .fontColor(Colors.text)
        .border({ width: 1, color: Colors.border })
        .borderRadius(12)
        .onClick(() => router.pushUrl({ url: Routes.connectorParameters }))
      Button('设置')
        .height(44)
        .width(76)
        .fontSize(15)
        .margin({ left: 10 })
        .backgroundColor(Colors.card)
        .fontColor(Colors.text)
        .border({ width: 1, color: Colors.border })
        .borderRadius(12)
        .onClick(() => router.pushUrl({ url: Routes.settings }))
      Column() {
        Text('当前用户')
          .fontSize(11)
          .fontColor(Colors.textMuted)
        Text(this.username)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(Colors.text)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width(118)
      .alignItems(HorizontalAlign.End)
      .margin({ left: 14, right: 12 })
      Button('退出')
        .height(44)
        .width(72)
        .fontSize(15)
        .fontColor(Colors.primary)
        .backgroundColor(Colors.primaryLight)
        .borderRadius(12)
        .onClick(() => this.onLogout())
    }
    .height(76)
    .width('100%')
    .padding({ left: 24, right: 24 })
    .backgroundColor(Colors.card)
    .border({ width: { bottom: 1 }, color: Colors.border })
  }
}
