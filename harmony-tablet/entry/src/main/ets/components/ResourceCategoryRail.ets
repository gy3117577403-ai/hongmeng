import { Colors } from '../constants/colors';
import type { ResourceCategory } from '../models/ResourceCategory';

function categoryRequiredLabel(category: ResourceCategory): string {
  if (category.required) return '必填';
  return '可选';
}

function categoryStateText(category: ResourceCategory): string {
  const count = category.fileCount || 0;
  if (count > 0) return `${count} 个`;
  if (category.required) return '缺资料';
  return '可选';
}

function categoryStateColor(category: ResourceCategory): string {
  const count = category.fileCount || 0;
  if (count > 0) return Colors.success;
  if (category.required) return Colors.primary;
  return Colors.textMuted;
}

function categoryShortLabel(category: ResourceCategory): string {
  if (category.code === 'drawing') return '原';
  if (category.code === 'sop') return 'SOP';
  if (category.code === 'product') return '成';
  if (category.code === 'material') return '辅';
  if (category.code === 'notice') return '注';
  return category.name.slice(0, 1);
}

function missingCount(categories: ResourceCategory[]): number {
  let count = 0;
  for (let i = 0; i < categories.length; i++) {
    const item = categories[i];
    if (item.required && (item.fileCount || 0) === 0) {
      count++;
    }
  }
  return count;
}

function finishedCount(categories: ResourceCategory[]): number {
  let count = 0;
  for (let i = 0; i < categories.length; i++) {
    if ((categories[i].fileCount || 0) > 0) {
      count++;
    }
  }
  return count;
}

@Component
export struct ResourceCategoryRail {
  categories: ResourceCategory[] = [];
  selectedId: string = '';
  onSelect: (category: ResourceCategory) => void = () => {};
  onOpenUploadManager: () => void = () => {};

  build(): void {
    Column() {
      Text('资料分类')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(Colors.text)
      Text(`缺资料 ${missingCount(this.categories)} · ${finishedCount(this.categories)}/${this.categories.length || 5}`)
        .fontSize(12)
        .fontColor(missingCount(this.categories) > 0 ? Colors.primary : Colors.success)
        .margin({ top: 4, bottom: 12 })
      ForEach(this.categories, (category: ResourceCategory) => {
        Row() {
          Stack({ alignContent: Alignment.TopEnd }) {
            Text(categoryShortLabel(category))
              .fontSize(category.code === 'sop' ? 12 : 15)
              .fontWeight(FontWeight.Bold)
              .fontColor(category.id === this.selectedId ? Color.White : Colors.primary)
              .textAlign(TextAlign.Center)
              .width(36)
              .height(36)
              .backgroundColor(category.id === this.selectedId ? Colors.primary : Colors.primaryLight)
              .borderRadius(12)
            Column()
              .width(8)
              .height(8)
              .backgroundColor(categoryStateColor(category))
              .borderRadius(4)
          }
          .width(40)
          .height(40)
          .margin({ right: 10 })
          Column() {
            Text(category.name)
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(category.id === this.selectedId ? Colors.primary : Colors.text)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Row() {
              Text(categoryRequiredLabel(category))
                .fontSize(11)
                .fontColor(Colors.textMuted)
              Text(categoryStateText(category))
                .fontSize(11)
                .fontColor(categoryStateColor(category))
                .margin({ left: 8 })
            }
            .margin({ top: 6 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .height(78)
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .margin({ bottom: 10 })
        .padding({ left: 12, right: 10 })
        .backgroundColor(category.id === this.selectedId ? Colors.primaryLight : Colors.card)
        .border({ width: 1, color: category.id === this.selectedId ? Colors.primary : Colors.border })
        .borderRadius(16)
        .onClick(() => this.onSelect(category))
      })
      Row() {
        Text('管')
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(Colors.text)
          .textAlign(TextAlign.Center)
          .width(36)
          .height(36)
          .backgroundColor('#F3F4F6')
          .borderRadius(12)
          .margin({ right: 10 })
        Column() {
          Text('上传管理')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Colors.text)
          Text('队列 / 文件')
            .fontSize(11)
            .fontColor(Colors.textMuted)
            .margin({ top: 6 })
        }
        .alignItems(HorizontalAlign.Start)
      }
      .height(70)
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ left: 12, right: 10 })
      .backgroundColor(Colors.card)
      .border({ width: 1, color: Colors.border })
      .borderRadius(16)
      .onClick(() => this.onOpenUploadManager())
    }
    .width(164)
    .height('100%')
    .padding({ left: 12, right: 12, top: 14 })
    .backgroundColor('#FBFCFE')
    .borderRadius(18)
  }
}
