import { Colors } from '../constants/colors';
import type { ResourceCategory } from '../models/ResourceCategory';
import type { WorkOrder } from '../models/WorkOrder';
import { formatDateTime } from '../utils/date';
import { priorityLabel, stageLabel } from '../utils/format';

function requiredCategory(code: string): boolean {
  return code === 'drawing' || code === 'sop' || code === 'product';
}

function missingRequiredCount(categories: ResourceCategory[]): number {
  let missing = 0;
  for (let i = 0; i < categories.length; i++) {
    const item = categories[i];
    const count = item.fileCount || 0;
    if (requiredCategory(item.code) && count === 0) {
      missing++;
    }
  }
  return missing;
}

@Component
export struct CurrentWorkOrderBar {
  order?: WorkOrder;
  categories: ResourceCategory[] = [];

  build(): void {
    Column() {
      if (this.order) {
        Row() {
          Column() {
            Text(this.order?.code || '-')
              .fontSize(21)
              .fontWeight(FontWeight.Bold)
              .fontColor(Colors.text)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(`${this.order?.customerName || '未填客户'} · ${this.order?.productName || '-'}`)
              .fontSize(14)
              .fontColor(Colors.textMuted)
              .margin({ top: 4 })
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text(stageLabel(this.order?.stage))
            .fontSize(14)
            .fontColor(Color.White)
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor(Colors.primary)
            .borderRadius(12)
          Text(priorityLabel(this.order?.priority))
            .fontSize(14)
            .fontColor(Colors.text)
            .margin({ left: 10 })
            .padding({ left: 12, right: 12, top: 6, bottom: 6 })
            .backgroundColor('#F3F4F6')
            .borderRadius(12)
        }
        Row() {
          Text(`资料数量 ${this.order?.totalFileCount || 0}`)
            .fontSize(13)
            .fontColor(Colors.success)
          Text(`缺失分类 ${missingRequiredCount(this.categories)}`)
            .fontSize(13)
            .fontColor(missingRequiredCount(this.categories) > 0 ? Colors.primary : Colors.success)
            .margin({ left: 18 })
          Text(`计划日期 ${formatDateTime(this.order?.plannedAt)}`)
            .fontSize(13)
            .fontColor(Colors.textMuted)
            .margin({ left: 18 })
          Text(`进度 ${this.order?.progress || 0}%`)
            .fontSize(13)
            .fontColor(Colors.textMuted)
            .margin({ left: 18 })
        }
        .margin({ top: 10 })
      } else {
        Row() {
          Text('暂无选中工单')
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
          Text('请打开左上角工单抽屉选择或等待列表加载')
            .fontSize(14)
            .fontColor(Colors.textMuted)
            .margin({ left: 14 })
        }
      }
    }
    .height(88)
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ left: 20, right: 20 })
    .backgroundColor(Colors.card)
    .borderRadius(16)
    .shadow({ radius: 14, color: '#10000000', offsetY: 4 })
  }
}
