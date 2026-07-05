import { Colors } from '../constants/colors';
import type { WorkOrder } from '../models/WorkOrder';
import { VoiceInputAdapter } from '../platform/VoiceInputAdapter';
import { formatDateTime } from '../utils/date';
import { priorityLabel, stageLabel } from '../utils/format';

function drawerStageText(value: string): string {
  if (value.length === 0) return '全部';
  return stageLabel(value);
}

function drawerCompletionText(order: WorkOrder): string {
  const count = order.totalFileCount || 0;
  if (count > 0) return '有资料';
  return '缺资料';
}

function drawerCompletionColor(order: WorkOrder): string {
  const count = order.totalFileCount || 0;
  if (count > 0) return Colors.success;
  return Colors.primary;
}

@Component
export struct WorkOrderDrawer {
  visible: boolean = false;
  orders: WorkOrder[] = [];
  selectedId: string = '';
  keyword: string = '';
  stageFilter: string = '';
  onClose: () => void = () => {};
  onSelect: (order: WorkOrder) => void = () => {};
  onSearch: (keyword: string) => void = () => {};
  onStageFilter: (stage: string) => void = () => {};
  onVoiceSearch: () => void = () => {};

  stageOptions(): string[] {
    return ['', 'not_issued', 'frontend', 'backend', 'completed'];
  }

  visibleOrders(): WorkOrder[] {
    if (this.stageFilter.length === 0) return this.orders;
    const filtered: WorkOrder[] = [];
    for (let i = 0; i < this.orders.length; i++) {
      if (this.orders[i].stage === this.stageFilter) {
        filtered.push(this.orders[i]);
      }
    }
    return filtered;
  }

  build(): void {
    if (this.visible) {
      Stack({ alignContent: Alignment.Start }) {
        Column()
          .width('100%')
          .height('100%')
          .backgroundColor('#66000000')
          .onClick(() => this.onClose())
        Column() {
          Row() {
            Text('工单列表')
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
            Blank()
            Button('关闭')
              .height(40)
              .fontSize(14)
              .backgroundColor(Colors.primaryLight)
              .fontColor(Colors.primary)
              .borderRadius(10)
              .onClick(() => this.onClose())
          }
          .padding({ left: 22, right: 20, top: 20, bottom: 8 })
          Text('搜索、筛选并切换当前生产工单')
            .fontSize(13)
            .fontColor(Colors.textMuted)
            .padding({ left: 22, right: 20, bottom: 12 })
          Row() {
            TextInput({ placeholder: '搜索工单号、客户、产品', text: this.keyword })
              .height(46)
              .layoutWeight(1)
              .fontSize(15)
              .backgroundColor(Colors.card)
              .border({ width: 1, color: Colors.border })
              .borderRadius(12)
              .onChange(value => this.keyword = value)
            Button('搜索')
              .height(46)
              .fontSize(15)
              .fontColor(Color.White)
              .backgroundColor(Colors.primary)
              .borderRadius(12)
              .margin({ left: 10 })
              .onClick(() => this.onSearch(this.keyword))
            Button(VoiceInputAdapter.buttonText())
              .height(46)
              .fontSize(15)
              .fontColor(Colors.primary)
              .backgroundColor(Colors.primaryLight)
              .borderRadius(12)
              .margin({ left: 10 })
              .onClick(() => this.onVoiceSearch())
          }
          .padding({ left: 16, right: 16, bottom: 10 })
          Scroll() {
            Row() {
              ForEach(this.stageOptions(), (stage: string) => {
                Button(drawerStageText(stage))
                  .height(36)
                  .fontSize(13)
                  .fontColor(stage === this.stageFilter ? Color.White : Colors.text)
                  .backgroundColor(stage === this.stageFilter ? Colors.primary : Colors.card)
                  .border({ width: 1, color: stage === this.stageFilter ? Colors.primary : Colors.border })
                  .borderRadius(18)
                  .margin({ right: 8 })
                  .onClick(() => this.onStageFilter(stage))
              })
            }
            .padding({ left: 16, right: 16 })
          }
          .height(44)
          .scrollable(ScrollDirection.Horizontal)
          .margin({ bottom: 8 })
          Scroll() {
            Column() {
              ForEach(this.visibleOrders(), (item: WorkOrder) => {
                Column() {
                  Row() {
                    Text(item.code)
                      .fontSize(17)
                      .fontWeight(FontWeight.Bold)
                      .fontColor(Colors.text)
                      .layoutWeight(1)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(stageLabel(item.stage))
                      .fontSize(12)
                      .fontColor(Color.White)
                      .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                      .backgroundColor(Colors.primary)
                      .borderRadius(12)
                  }
                  Row() {
                    Text(`客户：${item.customerName || '未填客户'}`)
                      .fontSize(13)
                      .fontColor(Colors.textMuted)
                      .layoutWeight(1)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(formatDateTime(item.plannedAt))
                      .fontSize(12)
                      .fontColor(Colors.textMuted)
                  }
                  .margin({ top: 8 })
                  Text(item.productName)
                    .fontSize(14)
                    .fontColor(Colors.text)
                    .margin({ top: 6 })
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Row() {
                    Text(priorityLabel(item.priority))
                      .fontSize(12)
                      .fontColor(Colors.text)
                      .padding({ left: 9, right: 9, top: 5, bottom: 5 })
                      .backgroundColor('#F3F4F6')
                      .borderRadius(10)
                    Text(drawerCompletionText(item))
                      .fontSize(12)
                      .fontColor(drawerCompletionColor(item))
                      .padding({ left: 9, right: 9, top: 5, bottom: 5 })
                      .backgroundColor((item.totalFileCount || 0) > 0 ? '#ECFDF5' : Colors.primaryLight)
                      .borderRadius(10)
                      .margin({ left: 8 })
                    Text(`资料 ${item.totalFileCount || 0}`)
                      .fontSize(12)
                      .fontColor(Colors.textMuted)
                      .margin({ left: 10 })
                    Blank()
                    Text(`${item.progress || 0}%`)
                      .fontSize(12)
                      .fontColor(Colors.textMuted)
                  }
                  .margin({ top: 10 })
                }
                .width('100%')
                .padding(15)
                .margin({ bottom: 10 })
                .backgroundColor(item.id === this.selectedId ? Colors.primaryLight : Colors.card)
                .border({ width: 1, color: item.id === this.selectedId ? Colors.primary : Colors.border })
                .borderRadius(16)
                .onClick(() => this.onSelect(item))
              })
              if (this.visibleOrders().length === 0) {
                Text('未找到匹配工单')
                  .fontSize(15)
                  .fontColor(Colors.textMuted)
                  .width('100%')
                  .height(100)
                  .textAlign(TextAlign.Center)
              }
            }
            .padding({ left: 16, right: 16, bottom: 20 })
          }
        }
        .width(448)
        .height('100%')
        .backgroundColor(Colors.bg)
      }
      .width('100%')
      .height('100%')
    }
  }
}
