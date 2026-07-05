import router from '@ohos.router';
import type common from '@ohos.app.ability.common';
import { Colors } from '../constants/colors';
import { ConnectorParameterTable } from '../components/ConnectorParameterTable';
import { CommonButton } from '../components/CommonButton';
import type { ConnectorParameter } from '../models/ConnectorParameter';
import { ToastAdapter } from '../platform/ToastAdapter';
import { ApiException } from '../services/httpClient';
import * as connectorApi from '../services/connectorApi';
import type { ConnectorParameterRequest, ConnectorQuery } from '../services/connectorApi';
import { AuthStore } from '../stores/AuthStore';

@Entry
@Component
struct ConnectorParametersPage {
  @State keyword: string = '';
  @State filter: string = 'all';
  @State loading: boolean = false;
  @State parameters: ConnectorParameter[] = [];
  @State total: number = 0;
  @State editorOpen: boolean = false;
  @State deleting?: ConnectorParameter = undefined;
  @State editing?: ConnectorParameter = undefined;
  @State formRowNo: string = '';
  @State formModel: string = '';
  @State formOuter: string = '';
  @State formInner: string = '';
  @State formInsertion: string = '';
  @State formRemark: string = '';
  @State formHighlighted: boolean = false;
  @State saving: boolean = false;

  async aboutToAppear(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const query: ConnectorQuery = {
        keyword: this.keyword,
        page: 1,
        missing: this.filter === 'outer' || this.filter === 'inner' || this.filter === 'insertion' ? this.filter : '',
        highlighted: this.filter === 'highlighted'
      };
      const data = await connectorApi.fetchConnectorParameters(query);
      this.parameters = data.parameters;
      this.total = data.total;
    } catch (err) {
      await this.handleError(err as Error, '连接器参数加载失败');
    } finally {
      this.loading = false;
    }
  }

  async handleError(err: Error, fallback: string): Promise<void> {
    if (err instanceof ApiException && err.needLogin) {
      const context = getContext(this) as common.UIAbilityContext;
      await AuthStore.handleUnauthorized(context);
      return;
    }
    ToastAdapter.error(err.message || fallback);
  }

  setFilter(value: string): void {
    this.filter = value;
    this.load();
  }

  openCreate(): void {
    this.editing = undefined;
    this.formRowNo = '';
    this.formModel = '';
    this.formOuter = '';
    this.formInner = '';
    this.formInsertion = '';
    this.formRemark = '';
    this.formHighlighted = false;
    this.editorOpen = true;
  }

  openEdit(item: ConnectorParameter): void {
    this.editing = item;
    this.formRowNo = item.rowNo === null || item.rowNo === undefined ? '' : `${item.rowNo}`;
    this.formModel = item.model || '';
    this.formOuter = item.outerPeelMm || '';
    this.formInner = item.innerPeelMm || '';
    this.formInsertion = item.insertionLengthMm || '';
    this.formRemark = item.remark || '';
    this.formHighlighted = item.isHighlighted;
    this.editorOpen = true;
  }

  formBody(): ConnectorParameterRequest {
    const body: ConnectorParameterRequest = {
      rowNo: this.formRowNo,
      model: this.formModel,
      outerPeelMm: this.formOuter,
      innerPeelMm: this.formInner,
      insertionLengthMm: this.formInsertion,
      remark: this.formRemark,
      isHighlighted: this.formHighlighted
    };
    return body;
  }

  async save(): Promise<void> {
    this.saving = true;
    try {
      if (this.editing) {
        await connectorApi.updateConnectorParameter(this.editing.id, this.formBody());
        ToastAdapter.success('参数已更新');
      } else {
        await connectorApi.saveConnectorParameter(this.formBody());
        ToastAdapter.success('参数已新增');
      }
      this.editorOpen = false;
      await this.load();
    } catch (err) {
      await this.handleError(err as Error, '保存连接器参数失败');
    } finally {
      this.saving = false;
    }
  }

  async confirmDelete(): Promise<void> {
    if (!this.deleting) return;
    try {
      await connectorApi.deleteConnectorParameter(this.deleting.id);
      ToastAdapter.success('参数已删除');
      this.deleting = undefined;
      await this.load();
    } catch (err) {
      await this.handleError(err as Error, '删除连接器参数失败');
    }
  }

  @Builder
  filterButton(label: string, value: string): void {
    Button(label)
      .height(38)
      .fontSize(14)
      .fontColor(this.filter === value ? Color.White : Colors.text)
      .backgroundColor(this.filter === value ? Colors.primary : Colors.card)
      .border({ width: 1, color: this.filter === value ? Colors.primary : Colors.border })
      .borderRadius(12)
      .margin({ right: 8 })
      .onClick(() => this.setFilter(value))
  }

  build(): void {
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
        CommonButton({ label: '新增参数', onTap: () => this.openCreate() })
          .margin({ left: 14 })
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
        CommonButton({ label: this.loading ? '查询中' : '查询', isEnabled: !this.loading, onTap: () => this.load() })
          .margin({ left: 12 })
      }
      .padding({ left: 20, right: 20, top: 16, bottom: 12 })
      Row() {
        this.filterButton('全部', 'all')
        this.filterButton('缺外剥皮', 'outer')
        this.filterButton('缺内剥皮', 'inner')
        this.filterButton('缺入长', 'insertion')
        this.filterButton('重点', 'highlighted')
        Blank()
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
        if (this.loading) {
          Text('加载中')
            .fontSize(16)
            .fontColor(Colors.textMuted)
            .padding(20)
        } else if (this.parameters.length === 0) {
          Text('暂无连接器参数')
            .fontSize(18)
            .fontColor(Colors.textMuted)
            .padding(32)
        } else {
          ConnectorParameterTable({
            items: this.parameters,
            onEdit: (item: ConnectorParameter) => this.openEdit(item),
            onDelete: (item: ConnectorParameter) => this.deleting = item
          })
        }
      }
      .layoutWeight(1)
      .padding({ left: 20, right: 20, bottom: 20 })
      if (this.editorOpen) {
        Column() {
          Text(this.editing ? '编辑参数' : '新增参数')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
          Row() {
            TextInput({ placeholder: '序号', text: this.formRowNo }).height(44).layoutWeight(1).onChange(v => this.formRowNo = v)
            TextInput({ placeholder: '型号', text: this.formModel }).height(44).layoutWeight(2).margin({ left: 10 }).onChange(v => this.formModel = v)
          }
          .margin({ top: 16 })
          Row() {
            TextInput({ placeholder: '外剥皮mm', text: this.formOuter }).height(44).layoutWeight(1).onChange(v => this.formOuter = v)
            TextInput({ placeholder: '内剥皮mm', text: this.formInner }).height(44).layoutWeight(1).margin({ left: 10 }).onChange(v => this.formInner = v)
            TextInput({ placeholder: '入长mm', text: this.formInsertion }).height(44).layoutWeight(1).margin({ left: 10 }).onChange(v => this.formInsertion = v)
          }
          .margin({ top: 12 })
          TextInput({ placeholder: '备注', text: this.formRemark })
            .height(72)
            .margin({ top: 12 })
            .onChange(v => this.formRemark = v)
          Row() {
            Checkbox()
              .select(this.formHighlighted)
              .onChange(v => this.formHighlighted = v)
            Text('标记为重点')
              .fontSize(15)
              .fontColor(Colors.text)
              .margin({ left: 8 })
          }
          .margin({ top: 12, bottom: 18 })
          Row() {
            CommonButton({ label: this.saving ? '保存中' : '保存', isEnabled: !this.saving, onTap: () => this.save() })
              .margin({ right: 12 })
            CommonButton({ label: '取消', primary: false, onTap: () => this.editorOpen = false })
          }
        }
        .width(560)
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
      if (this.deleting) {
        Column() {
          Text('确认删除')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.danger)
          Text(`将软删除型号：${this.deleting?.model || '-'}`)
            .fontSize(15)
            .fontColor(Colors.textMuted)
            .margin({ top: 12, bottom: 18 })
          Row() {
            CommonButton({ label: '确认删除', danger: true, onTap: () => this.confirmDelete() })
              .margin({ right: 12 })
            CommonButton({ label: '取消', primary: false, onTap: () => this.deleting = undefined })
          }
        }
        .width(420)
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Colors.bg)
  }
}
