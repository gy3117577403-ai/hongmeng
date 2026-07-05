import router from '@ohos.router';
import type common from '@ohos.app.ability.common';
import { Colors } from '../constants/colors';
import { ConnectorParameterTable } from '../components/ConnectorParameterTable';
import { CommonButton } from '../components/CommonButton';
import type { ConnectorParameter } from '../models/ConnectorParameter';
import { ClipboardAdapter } from '../platform/ClipboardAdapter';
import { DownloadAdapter } from '../platform/DownloadAdapter';
import { FilePickerAdapter, PickedFile } from '../platform/FilePickerAdapter';
import { ToastAdapter } from '../platform/ToastAdapter';
import { VoiceInputAdapter } from '../platform/VoiceInputAdapter';
import { ApiException } from '../services/httpClient';
import * as connectorApi from '../services/connectorApi';
import type { ConnectorAttachment, ConnectorImportBatch, ConnectorImportPreviewRow, ConnectorImportPreviewSummary, ConnectorParameterRequest, ConnectorQuery } from '../services/connectorApi';
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
  @State selectedIds: string[] = [];
  @State toolsOpen: boolean = false;
  @State importText: string = '';
  @State previewRows: ConnectorImportPreviewRow[] = [];
  @State previewSummary?: ConnectorImportPreviewSummary = undefined;
  @State importDuplicates: boolean = false;
  @State attachments: ConnectorAttachment[] = [];
  @State batches: ConnectorImportBatch[] = [];

  async aboutToAppear(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const query: ConnectorQuery = {
        keyword: this.keyword,
        page: 1,
        missing: this.filter === 'outer' || this.filter === 'inner' || this.filter === 'insertion' || this.filter === 'any' ? this.filter : '',
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

  async voiceInputFallback(targetName: string): Promise<void> {
    const text = await VoiceInputAdapter.startDictation(targetName);
    if (text.length === 0) return;
    if (targetName === '连接器搜索') {
      this.keyword = text;
      await this.load();
      return;
    }
    if (targetName === '连接器备注') {
      this.formRemark = text;
    }
  }

  isSelected(item: ConnectorParameter): boolean {
    for (let i = 0; i < this.selectedIds.length; i++) {
      if (this.selectedIds[i] === item.id) return true;
    }
    return false;
  }

  toggleSelect(item: ConnectorParameter): void {
    const next: string[] = [];
    let found = false;
    for (let i = 0; i < this.selectedIds.length; i++) {
      if (this.selectedIds[i] === item.id) {
        found = true;
      } else {
        next.push(this.selectedIds[i]);
      }
    }
    if (!found) next.push(item.id);
    this.selectedIds = next;
  }

  copyRow(item: ConnectorParameter): void {
    const text = `${item.model || ''} ${item.outerPeelMm || ''} ${item.innerPeelMm || ''} ${item.insertionLengthMm || ''} ${item.remark || ''}`;
    ClipboardAdapter.copyText(text, '连接器参数');
  }

  async batchAction(action: string): Promise<void> {
    if (this.selectedIds.length === 0) {
      ToastAdapter.error('请先选择参数行');
      return;
    }
    try {
      const data = await connectorApi.batchConnectorParameters(this.selectedIds, action);
      this.selectedIds = [];
      await this.load();
      ToastAdapter.success(`批量操作完成：${data.count} 条`);
    } catch (err) {
      await this.handleError(err as Error, '批量操作失败');
    }
  }

  async openTools(): Promise<void> {
    this.toolsOpen = true;
    await this.loadAttachmentsAndBatches();
  }

  async loadAttachmentsAndBatches(): Promise<void> {
    try {
      const files = await connectorApi.fetchConnectorAttachments();
      const batches = await connectorApi.fetchImportBatches();
      this.attachments = files.files;
      this.batches = batches.batches;
    } catch (err) {
      await this.handleError(err as Error, '连接器资料工具加载失败');
    }
  }

  async previewImport(): Promise<void> {
    try {
      const data = await connectorApi.previewConnectorImport(this.importText);
      this.previewRows = data.rows;
      this.previewSummary = data.summary;
      ToastAdapter.success('导入预览已生成');
    } catch (err) {
      await this.handleError(err as Error, '导入预览失败');
    }
  }

  async previewImportFile(): Promise<void> {
    try {
      const files: PickedFile[] = await FilePickerAdapter.pickAnySupportedFile();
      if (files.length === 0) {
        ToastAdapter.show('已取消选择');
        return;
      }
      const data = await connectorApi.previewConnectorImportFile(files[0]);
      this.previewRows = data.rows;
      this.previewSummary = data.summary;
      this.importText = '';
      ToastAdapter.success('文件导入预览已生成');
    } catch (err) {
      await this.handleError(err as Error, '文件导入预览失败');
    }
  }

  async commitImport(): Promise<void> {
    if (this.previewRows.length === 0) {
      ToastAdapter.error('请先生成导入预览');
      return;
    }
    try {
      const data = await connectorApi.commitConnectorImport(this.previewRows, this.importDuplicates);
      this.previewRows = [];
      this.previewSummary = undefined;
      this.importText = '';
      await this.load();
      ToastAdapter.success(`导入完成：新增 ${data.summary.created}，跳过 ${data.summary.skipped}`);
    } catch (err) {
      await this.handleError(err as Error, '确认导入失败');
    }
  }

  async deleteAttachment(file: ConnectorAttachment): Promise<void> {
    try {
      await connectorApi.deleteConnectorAttachment(file.id);
      await this.loadAttachmentsAndBatches();
      ToastAdapter.success('附件已删除');
    } catch (err) {
      await this.handleError(err as Error, '附件删除失败');
    }
  }

  async rollbackBatch(batch: ConnectorImportBatch): Promise<void> {
    try {
      await connectorApi.rollbackImportBatch(batch.id);
      await this.loadAttachmentsAndBatches();
      await this.load();
      ToastAdapter.success('导入批次已回滚');
    } catch (err) {
      await this.handleError(err as Error, '导入批次回滚失败');
    }
  }

  async exportCsv(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    await DownloadAdapter.downloadPackage('connector-parameters.csv', connectorApi.connectorExportUrl(), context);
  }

  async downloadTemplate(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    await DownloadAdapter.downloadPackage('connector-parameter-template.csv', connectorApi.connectorTemplateUrl(), context);
  }

  async uploadAttachment(): Promise<void> {
    try {
      const files: PickedFile[] = await FilePickerAdapter.pickAnySupportedFile();
      if (files.length === 0) {
        ToastAdapter.show('已取消选择');
        return;
      }
      for (let i = 0; i < files.length; i++) {
        await connectorApi.uploadConnectorAttachment(files[i]);
      }
      await this.loadAttachmentsAndBatches();
      ToastAdapter.success('原始资料附件已上传');
    } catch (err) {
      await this.handleError(err as Error, '原始资料附件上传失败');
    }
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
        CommonButton({ label: '导出 CSV', primary: false, onTap: () => this.exportCsv() })
          .margin({ left: 14 })
        CommonButton({ label: '导入 / 附件', primary: false, onTap: () => this.openTools() })
          .margin({ left: 10 })
        CommonButton({ label: '新增参数', onTap: () => this.openCreate() })
          .margin({ left: 10 })
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
        CommonButton({ label: VoiceInputAdapter.buttonText(), primary: false, onTap: () => this.voiceInputFallback('连接器搜索') })
          .margin({ left: 10 })
      }
      .padding({ left: 20, right: 20, top: 16, bottom: 12 })
      Row() {
        this.filterButton('全部', 'all')
        this.filterButton('缺外剥皮', 'outer')
        this.filterButton('缺内剥皮', 'inner')
        this.filterButton('缺入长', 'insertion')
        this.filterButton('任意缺失', 'any')
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
      Row() {
        Text(`已选择 ${this.selectedIds.length} 条`)
          .fontSize(14)
          .fontColor(Colors.textMuted)
        CommonButton({ label: '批量标重点', primary: false, onTap: () => this.batchAction('highlight') })
          .margin({ left: 12 })
        CommonButton({ label: '批量取消重点', primary: false, onTap: () => this.batchAction('unhighlight') })
          .margin({ left: 10 })
        CommonButton({ label: '批量删除', danger: true, onTap: () => this.batchAction('delete') })
          .margin({ left: 10 })
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
            selectedIds: this.selectedIds,
            onToggleSelect: (item: ConnectorParameter) => this.toggleSelect(item),
            onCopy: (item: ConnectorParameter) => this.copyRow(item),
            onEdit: (item: ConnectorParameter) => this.openEdit(item),
            onDelete: (item: ConnectorParameter) => this.deleting = item
          })
        }
      }
      .layoutWeight(1)
      .padding({ left: 20, right: 20, bottom: 20 })
      if (this.toolsOpen) {
        Column() {
          Row() {
            Text('导入 / 附件 / 批次')
              .fontSize(22)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
            Blank()
            Button('关闭')
              .height(36)
              .fontSize(14)
              .backgroundColor(Colors.primaryLight)
              .fontColor(Colors.primary)
              .borderRadius(10)
              .onClick(() => this.toolsOpen = false)
          }
          Row() {
            Column() {
              Text('粘贴 CSV 导入')
                .fontSize(16)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
              TextInput({ placeholder: '粘贴包含表头的 CSV 内容，先预览再入库', text: this.importText })
                .height(96)
                .margin({ top: 10 })
                .onChange(value => this.importText = value)
              Row() {
                Checkbox()
                  .select(this.importDuplicates)
                  .onChange(value => this.importDuplicates = value)
                Text('仍然导入重复行')
                  .fontSize(14)
                  .fontColor(Colors.text)
                  .margin({ left: 8 })
              }
              .margin({ top: 10 })
              Row() {
                CommonButton({ label: '生成预览', onTap: () => this.previewImport() })
                  .margin({ right: 10 })
                CommonButton({ label: '选择文件预览', primary: false, onTap: () => this.previewImportFile() })
                  .margin({ right: 10 })
                CommonButton({ label: '确认导入', primary: false, onTap: () => this.commitImport() })
              }
              .margin({ top: 12 })
              if (this.previewSummary) {
                Text(`总 ${this.previewSummary?.totalRows || 0} · 可导入 ${this.previewSummary?.readyCount || 0} · 重复 ${this.previewSummary?.duplicateCount || 0} · 异常 ${this.previewSummary?.invalidCount || 0} · 跳过 ${this.previewSummary?.skippedCount || 0}`)
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                  .margin({ top: 10 })
              }
              Row() {
                CommonButton({ label: '下载模板', primary: false, onTap: () => this.downloadTemplate() })
                  .margin({ right: 10 })
                CommonButton({ label: '导出 CSV', primary: false, onTap: () => this.exportCsv() })
              }
              .margin({ top: 12 })
            }
            .layoutWeight(1)
            .padding(14)
            .backgroundColor('#F9FAFB')
            .borderRadius(14)

            Column() {
              Row() {
                Text('原始资料附件')
                  .fontSize(16)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Colors.text)
                  .layoutWeight(1)
                Button('上传')
                  .height(30)
                  .fontSize(12)
                  .backgroundColor(Colors.primaryLight)
                  .fontColor(Colors.primary)
                  .borderRadius(9)
                  .onClick(() => this.uploadAttachment())
              }
              Scroll() {
                Column() {
                  if (this.attachments.length === 0) {
                    Text('暂无附件')
                      .fontSize(14)
                      .fontColor(Colors.textMuted)
                      .padding(12)
                  }
                  ForEach(this.attachments, (file: ConnectorAttachment) => {
                    Row() {
                      Text(file.displayName || file.originalName)
                        .fontSize(13)
                        .fontColor(Colors.text)
                        .layoutWeight(1)
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                      Button('下载')
                        .height(30)
                        .fontSize(12)
                        .backgroundColor(Colors.primaryLight)
                        .fontColor(Colors.primary)
                        .borderRadius(9)
                        .onClick(() => {
                          const context = getContext(this) as common.UIAbilityContext;
                          DownloadAdapter.downloadPackage(file.originalName, connectorApi.connectorAttachmentDownloadUrl(file), context);
                        })
                      Button('删除')
                        .height(30)
                        .fontSize(12)
                        .margin({ left: 8 })
                        .backgroundColor('#FEF2F2')
                        .fontColor(Colors.danger)
                        .borderRadius(9)
                        .onClick(() => this.deleteAttachment(file))
                    }
                    .padding(10)
                    .margin({ bottom: 8 })
                    .backgroundColor(Colors.card)
                    .border({ width: 1, color: Colors.border })
                    .borderRadius(12)
                  })
                }
              }
              .height(178)
            }
            .layoutWeight(1)
            .padding(14)
            .margin({ left: 12 })
            .backgroundColor('#F9FAFB')
            .borderRadius(14)
          }
          .margin({ top: 14 })
          Column() {
            Text('最近导入批次')
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
            Scroll() {
              Row() {
                ForEach(this.batches, (batch: ConnectorImportBatch) => {
                  Column() {
                    Text(batch.fileName || batch.id)
                      .fontSize(13)
                      .fontColor(Colors.text)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(`导入 ${batch.insertedCount} / ${batch.totalRows} · ${batch.rolledBackAt ? '已回滚' : '可回滚'}`)
                      .fontSize(12)
                      .fontColor(batch.rolledBackAt ? Colors.textMuted : Colors.primary)
                      .margin({ top: 5 })
                    Button('回滚')
                      .height(30)
                      .fontSize(12)
                      .fontColor(Colors.danger)
                      .backgroundColor('#FEF2F2')
                      .borderRadius(9)
                      .margin({ top: 8 })
                      .onClick(() => this.rollbackBatch(batch))
                  }
                  .width(220)
                  .padding(12)
                  .margin({ right: 10 })
                  .backgroundColor(Colors.card)
                  .border({ width: 1, color: Colors.border })
                  .borderRadius(12)
                })
              }
            }
            .height(112)
            .scrollable(ScrollDirection.Horizontal)
          }
          .padding(14)
          .margin({ top: 12 })
          .backgroundColor('#FFFDFB')
          .borderRadius(14)
        }
        .width(840)
        .padding(22)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
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
          Button(VoiceInputAdapter.buttonText('填写备注'))
            .height(34)
            .fontSize(13)
            .fontColor(Colors.primary)
            .backgroundColor(Colors.primaryLight)
            .borderRadius(10)
            .margin({ top: 10 })
            .onClick(() => this.voiceInputFallback('连接器备注'))
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
