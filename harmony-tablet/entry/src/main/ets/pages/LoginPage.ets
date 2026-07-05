import router from '@ohos.router';
import type common from '@ohos.app.ability.common';
import { Colors } from '../constants/colors';
import { Routes } from '../constants/routes';
import { CommonButton } from '../components/CommonButton';
import { ToastAdapter } from '../platform/ToastAdapter';
import { AuthStore } from '../stores/AuthStore';
import { notBlank } from '../utils/validators';

@Entry
@Component
struct LoginPage {
  @State username: string = '';
  @State password: string = '';
  @State loading: boolean = false;
  @State error: string = '';

  aboutToAppear(): void {
    if (AuthStore.isAuthenticated()) {
      router.replaceUrl({ url: Routes.workbench });
    }
  }

  async doLogin(): Promise<void> {
    if (!notBlank(this.username) || !notBlank(this.password)) {
      this.error = '请输入账号和密码';
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      await AuthStore.login(context, this.username, this.password);
      ToastAdapter.success('登录成功');
      router.replaceUrl({ url: Routes.workbench });
    } catch (err) {
      const error = err as Error;
      this.error = error.message || '登录失败';
    } finally {
      this.loading = false;
    }
  }

  build(): void {
    Row() {
      Column() {
        Text('工单资料库')
          .fontSize(36)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text('鸿蒙平板生产资料管理系统')
          .fontSize(18)
          .fontColor(Colors.textMuted)
          .margin({ top: 12, bottom: 36 })
        TextInput({ placeholder: '账号', text: this.username })
          .height(54)
          .fontSize(18)
          .backgroundColor('#F9FAFB')
          .borderRadius(14)
          .onChange(value => this.username = value)
        TextInput({ placeholder: '密码', text: this.password })
          .height(54)
          .fontSize(18)
          .type(InputType.Password)
          .backgroundColor('#F9FAFB')
          .borderRadius(14)
          .margin({ top: 16 })
          .onChange(value => this.password = value)
        if (this.error) {
          Text(this.error)
            .fontSize(14)
            .fontColor(Colors.danger)
            .margin({ top: 12 })
        }
        CommonButton({ label: this.loading ? '登录中' : '登录', isEnabled: !this.loading, onTap: () => this.doLogin() })
          .width('100%')
          .margin({ top: 24 })
      }
      .width(460)
      .padding(36)
      .backgroundColor(Colors.card)
      .borderRadius(22)
      .shadow({ radius: 24, color: '#18000000', offsetY: 8 })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .backgroundColor(Colors.bg)
  }
}
