import { Colors } from '../constants/colors';
import type { WorkOrder } from '../models/WorkOrder';
import { priorityLabel, stageLabel } from '../utils/format';

@Component
export struct WorkOrderDrawer {
  visible: boolean = false;
  orders: WorkOrder[] = [];
  selectedId: string = '';
  keyword: string = '';
  onClose: () => void = () => {};
  onSelect: (order: WorkOrder) => void = () => {};
  onSearch: (keyword: string) => void = () => {};

  build() {
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
              .fontSize(22)
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
          .padding({ left: 20, right: 20, top: 18, bottom: 10 })
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
          }
          .padding({ left: 16, right: 16, bottom: 12 })
          Scroll() {
            Column() {
              ForEach(this.orders, (item: WorkOrder) => {
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
                      .fontColor(Colors.primary)
                  }
                  Text(item.productName)
                    .fontSize(14)
                    .fontColor(Colors.textMuted)
                    .margin({ top: 6 })
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(`${item.customerName || '未填客户'} · ${priorityLabel(item.priority)} · 资料 ${item.totalFileCount || 0}`)
                    .fontSize(12)
                    .fontColor(Colors.textMuted)
                    .margin({ top: 6 })
                }
                .width('100%')
                .padding(14)
                .margin({ bottom: 10 })
                .backgroundColor(item.id === this.selectedId ? Colors.primaryLight : Colors.card)
                .border({ width: 1, color: item.id === this.selectedId ? Colors.primary : Colors.border })
                .borderRadius(14)
                .onClick(() => this.onSelect(item))
              })
            }
            .padding({ left: 16, right: 16, bottom: 20 })
          }
        }
        .width(390)
        .height('100%')
        .backgroundColor(Colors.bg)
      }
      .width('100%')
      .height('100%')
    }
  }
}
