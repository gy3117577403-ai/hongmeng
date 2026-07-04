import router from '@ohos.router';
import type common from '@ohos.app.ability.common';
import { API_BASE_URL } from '../constants/api';
import { Colors } from '../constants/colors';
import { CommonButton } from '../components/CommonButton';
import { ToastAdapter } from '../platform/ToastAdapter';
import { ApiException } from '../services/httpClient';
import * as systemApi from '../services/systemApi';
import { AuthStore } from '../stores/AuthStore';

@Entry
@Component
struct SettingsPage {
  @State loading: boolean = false;
  @State statusText: string = '未检查';
  @State databaseText: string = '-';
  @State storageText: string = '-';
  @State countText: string = '-';
  @State warningText: string = '-';

  async aboutToAppear() {
    await this.loadStatus();
  }

  async loadStatus() {
    this.loading = true;
    try {
      const status = await systemApi.fetchSystemStatus();
      this.statusText = status.ok ? '正常' : '异常';
      this.databaseText = `${status.database.type} · ${status.database.ok ? '正常' : '异常'} · ${status.database.latencyMs}ms`;
      this.storageText = `${status.storage.type} · ${status.storage.ok ? '正常' : '异常'} · ${status.storage.latencyMs}ms`;
      this.countText = `工单 ${status.counts.workOrders || 0} · 文件 ${status.counts.resourceFiles || 0} · 连接器 ${status.counts.connectorParameters || 0}`;
      this.warningText = status.warnings.length ? status.warnings.join('；') : '暂无';
    } catch (err) {
      if (err instanceof ApiException && err.needLogin) {
        const context = getContext(this) as common.UIAbilityContext;
        await AuthStore.handleUnauthorized(context);
        return;
      }
      ToastAdapter.error(err instanceof Error ? err.message : '系统状态加载失败');
      this.statusText = '检查失败';
    } finally {
      this.loading = false;
    }
  }

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
        Text('登录状态')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text(AuthStore.isAuthenticated() ? '已登录' : '未登录')
          .fontSize(15)
          .fontColor(AuthStore.isAuthenticated() ? Colors.success : Colors.danger)
          .margin({ top: 8, bottom: 24 })
        Text('系统状态')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text(this.statusText)
          .fontSize(15)
          .fontColor(this.statusText === '正常' ? Colors.success : Colors.textMuted)
          .margin({ top: 8 })
        Text(this.databaseText)
          .fontSize(14)
          .fontColor(Colors.textMuted)
          .margin({ top: 8 })
        Text(this.storageText)
          .fontSize(14)
          .fontColor(Colors.textMuted)
          .margin({ top: 8 })
        Text(this.countText)
          .fontSize(14)
          .fontColor(Colors.textMuted)
          .margin({ top: 8 })
        Text(`提示：${this.warningText}`)
          .fontSize(13)
          .fontColor(Colors.textMuted)
          .margin({ top: 8, bottom: 24 })
        CommonButton({
          label: this.loading ? '检查中...' : '刷新系统状态',
          primary: false,
          enabled: !this.loading,
          onTap: () => this.loadStatus()
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
