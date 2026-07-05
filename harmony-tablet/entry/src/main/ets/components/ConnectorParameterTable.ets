import { Colors } from '../constants/colors';
import type { ConnectorParameter } from '../models/ConnectorParameter';

@Component
export struct ConnectorParameterTable {
  items: ConnectorParameter[] = [];
  selectedIds: string[] = [];
  onToggleSelect: (item: ConnectorParameter) => void = () => {};
  onCopy: (item: ConnectorParameter) => void = () => {};
  onEdit: (item: ConnectorParameter) => void = () => {};
  onDelete: (item: ConnectorParameter) => void = () => {};

  isSelected(item: ConnectorParameter): boolean {
    for (let i = 0; i < this.selectedIds.length; i++) {
      if (this.selectedIds[i] === item.id) return true;
    }
    return false;
  }

  @Builder
  cell(text: string, width: number, bold: boolean = false): void {
    Text(text)
      .width(width)
      .fontSize(14)
      .fontWeight(bold ? FontWeight.Bold : FontWeight.Regular)
      .fontColor(Colors.text)
      .maxLines(2)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
  }

  build(): void {
    Column() {
      Row() {
        this.cell('选择', 64, true)
        this.cell('序号', 70, true)
        this.cell('型号', 210, true)
        this.cell('外剥皮mm', 120, true)
        this.cell('内剥皮mm', 120, true)
        this.cell('入长mm', 120, true)
        this.cell('备注', 280, true)
        this.cell('重点', 70, true)
        this.cell('操作', 220, true)
      }
      .height(48)
      .padding({ left: 14, right: 14 })
      .backgroundColor('#F3F4F6')
      .borderRadius(12)
      Scroll() {
        Column() {
          ForEach(this.items, (item: ConnectorParameter) => {
            Row() {
              Checkbox()
                .select(this.isSelected(item))
                .onChange(() => this.onToggleSelect(item))
                .width(64)
              this.cell(item.rowNo === null || item.rowNo === undefined ? '' : `${item.rowNo}`, 70)
              this.cell(item.model || '', 210)
              this.cell(item.outerPeelMm || '', 120)
              this.cell(item.innerPeelMm || '', 120)
              this.cell(item.insertionLengthMm || '', 120)
              this.cell(item.remark || '', 280)
              this.cell(item.isHighlighted ? '是' : '否', 70)
              Row() {
                Button('编辑')
                  .height(34)
                  .fontSize(13)
                  .backgroundColor(Colors.primaryLight)
                  .fontColor(Colors.primary)
                  .borderRadius(10)
                  .onClick(() => this.onEdit(item))
                Button('复制')
                  .height(34)
                  .fontSize(13)
                  .margin({ left: 8 })
                  .backgroundColor(Colors.card)
                  .fontColor(Colors.text)
                  .border({ width: 1, color: Colors.border })
                  .borderRadius(10)
                  .onClick(() => this.onCopy(item))
                Button('删除')
                  .height(34)
                  .fontSize(13)
                  .margin({ left: 8 })
                  .backgroundColor('#FEF2F2')
                  .fontColor(Colors.danger)
                  .borderRadius(10)
                  .onClick(() => this.onDelete(item))
              }
              .width(220)
            }
            .height(54)
            .padding({ left: 14, right: 14, top: 8, bottom: 8 })
            .margin({ top: 8 })
            .backgroundColor(item.isHighlighted ? Colors.warningBg : Colors.card)
            .border({ width: 1, color: Colors.border })
            .borderRadius(12)
          })
        }
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }
}
