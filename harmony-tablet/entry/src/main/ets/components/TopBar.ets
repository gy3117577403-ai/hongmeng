import router from '@ohos.router';
import { Colors } from '../constants/colors';
import { Routes } from '../constants/routes';

@Component
export struct TopBar {
  username: string = '';
  onOpenDrawer: () => void = () => {};
  onLogout: () => void = () => {};

  build() {
    Row() {
      Button('工单')
        .height(44)
        .fontSize(16)
        .fontColor(Color.White)
        .backgroundColor(Colors.primary)
        .borderRadius(12)
        .onClick(() => this.onOpenDrawer())
      Column() {
        Text('工单资料库')
          .fontSize(22)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text('鸿蒙平板生产资料管理系统')
          .fontSize(13)
          .fontColor(Colors.textMuted)
      }
      .margin({ left: 18 })
      .alignItems(HorizontalAlign.Start)
      Blank()
      Button('连接器参数')
        .height(44)
        .fontSize(15)
        .backgroundColor(Colors.card)
        .fontColor(Colors.text)
        .border({ width: 1, color: Colors.border })
        .borderRadius(12)
        .onClick(() => router.pushUrl({ url: Routes.connectorParameters }))
      Button('设置')
        .height(44)
        .fontSize(15)
        .margin({ left: 10 })
        .backgroundColor(Colors.card)
        .fontColor(Colors.text)
        .border({ width: 1, color: Colors.border })
        .borderRadius(12)
        .onClick(() => router.pushUrl({ url: Routes.settings }))
      Text(this.username)
        .fontSize(15)
        .fontColor(Colors.textMuted)
        .margin({ left: 14, right: 12 })
      Button('退出')
        .height(44)
        .fontSize(15)
        .fontColor(Colors.primary)
        .backgroundColor(Colors.primaryLight)
        .borderRadius(12)
        .onClick(() => this.onLogout())
    }
    .height(72)
    .width('100%')
    .padding({ left: 24, right: 24 })
    .backgroundColor(Colors.card)
    .border({ width: { bottom: 1 }, color: Colors.border })
  }
}
