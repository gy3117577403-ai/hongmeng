import { Colors } from '../constants/colors';
import type { WorkOrder } from '../models/WorkOrder';
import { formatDateTime } from '../utils/date';
import { priorityLabel, stageLabel } from '../utils/format';

@Component
export struct CurrentWorkOrderBar {
  order?: WorkOrder;

  build(): void {
    Row() {
      if (this.order) {
        Column() {
          Text(`${this.order?.customerName || '未填客户'} · ${this.order?.code || '-'}`)
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.order?.productName || '-')
            .fontSize(14)
            .fontColor(Colors.textMuted)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Text(stageLabel(this.order?.stage))
          .fontSize(14)
          .fontColor(Colors.primary)
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor(Colors.primaryLight)
          .borderRadius(10)
        Text(priorityLabel(this.order?.priority))
          .fontSize(14)
          .fontColor(Colors.text)
          .margin({ left: 10 })
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .backgroundColor('#F3F4F6')
          .borderRadius(10)
        Text(`计划 ${formatDateTime(this.order?.plannedAt)}`)
          .fontSize(14)
          .fontColor(Colors.textMuted)
          .margin({ left: 12 })
        Text(`资料 ${this.order?.totalFileCount || 0}`)
          .fontSize(14)
          .fontColor(Colors.success)
          .margin({ left: 12 })
      } else {
        Text('请选择一个工单')
          .fontSize(16)
          .fontColor(Colors.textMuted)
      }
    }
    .height(64)
    .width('100%')
    .padding({ left: 20, right: 20 })
    .backgroundColor(Colors.card)
    .borderRadius(16)
  }
}
