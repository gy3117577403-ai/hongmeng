import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import type common from '@ohos.app.ability.common';
import { API_BASE_URL } from '../constants/api';
import { Colors } from '../constants/colors';
import { CommonButton } from '../components/CommonButton';
import { AuthStore } from '../stores/AuthStore';

@Entry
@Component
struct SettingsPage {
  async logout() {
    const context = getContext(this) as common.UIAbilityContext;
    await AuthStore.logout(context);
    router.replaceUrl({ url: 'pages/LoginPage' });
  }

  build() {
    Column() {
      Row() {
        Button('返回')
          .height(44)
          .fontSize(15)
          .backgroundColor(Colors.primaryLight)
          .fontColor(Colors.primary)
          .borderRadius(12)
          .onClick(() => router.back())
        Text('设置')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
          .margin({ left: 18 })
      }
      .height(72)
      .padding({ left: 24, right: 24 })
      .backgroundColor(Colors.card)
      Column() {
        Text('当前服务器地址')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text(API_BASE_URL)
          .fontSize(15)
          .fontColor(Colors.textMuted)
          .margin({ top: 8, bottom: 24 })
        Text('当前登录用户')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text(AuthStore.user?.displayName || AuthStore.user?.username || '-')
          .fontSize(15)
          .fontColor(Colors.textMuted)
          .margin({ top: 8, bottom: 24 })
        CommonButton({
          label: '系统状态',
          primary: false,
          onTap: () => promptAction.showToast({ message: '后续接入 /api/system/status 原生展示' })
        })
        .width(220)
        .margin({ bottom: 12 })
        CommonButton({ label: '退出登录', danger: true, onTap: () => this.logout() })
          .width(220)
      }
      .alignItems(HorizontalAlign.Start)
      .padding(28)
      .margin(20)
      .backgroundColor(Colors.card)
      .borderRadius(18)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Colors.bg)
  }
}
