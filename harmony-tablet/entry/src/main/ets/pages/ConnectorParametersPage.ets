import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { Colors } from '../constants/colors';
import { ConnectorParameterTable } from '../components/ConnectorParameterTable';
import { CommonButton } from '../components/CommonButton';
import type { ConnectorParameter } from '../models/ConnectorParameter';
import * as connectorApi from '../services/connectorApi';

@Entry
@Component
struct ConnectorParametersPage {
  @State keyword: string = '';
  @State loading: boolean = false;
  @State parameters: ConnectorParameter[] = [];
  @State total: number = 0;

  async aboutToAppear() {
    await this.load();
  }

  async load() {
    this.loading = true;
    try {
      const data = await connectorApi.fetchConnectorParameters(this.keyword, 1);
      this.parameters = data.parameters;
      this.total = data.total;
    } catch (err) {
      promptAction.showToast({ message: err instanceof Error ? err.message : '连接器参数加载失败' });
    } finally {
      this.loading = false;
    }
  }

  build() {
    Column() {
      Row() {
        Button('返回工作台')
          .height(44)
          .fontSize(15)
          .backgroundColor(Colors.primaryLight)
          .fontColor(Colors.primary)
          .borderRadius(12)
          .onClick(() => router.back())
        Text('连接器参数资料')
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
          .margin({ left: 18 })
        Blank()
        Text(`共 ${this.total} 条`)
          .fontSize(15)
          .fontColor(Colors.textMuted)
      }
      .height(72)
      .padding({ left: 24, right: 24 })
      .backgroundColor(Colors.card)
      Row() {
        TextInput({ placeholder: '搜索型号、备注、数字参数', text: this.keyword })
          .height(48)
          .layoutWeight(1)
          .fontSize(16)
          .backgroundColor(Colors.card)
          .borderRadius(14)
          .onChange(value => this.keyword = value)
        CommonButton({ label: this.loading ? '查询中...' : '查询', enabled: !this.loading, onTap: () => this.load() })
          .margin({ left: 12 })
      }
      .padding({ left: 20, right: 20, top: 16, bottom: 12 })
      Row() {
        Text('统计')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
        Text(`当前显示 ${this.parameters.length} 条`)
          .fontSize(14)
          .fontColor(Colors.textMuted)
          .margin({ left: 12 })
        Text('重点行使用浅黄色标记')
          .fontSize(14)
          .fontColor(Colors.textMuted)
          .margin({ left: 12 })
      }
      .padding({ left: 20, right: 20, bottom: 10 })
      Column() {
        ConnectorParameterTable({ items: this.parameters })
      }
      .layoutWeight(1)
      .padding({ left: 20, right: 20, bottom: 20 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Colors.bg)
  }
}
