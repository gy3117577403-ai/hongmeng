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

@Component
export struct ResourceCategoryRail {
  categories: ResourceCategory[] = [];
  selectedId: string = '';
  onSelect: (category: ResourceCategory) => void = () => {};

  build(): void {
    Column() {
      Text('资料分类')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(Colors.text)
        .margin({ bottom: 12 })
      ForEach(this.categories, (category: ResourceCategory) => {
        Row() {
          Column()
            .width(8)
            .height(8)
            .backgroundColor(categoryStateColor(category))
            .borderRadius(4)
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
      if (this.categories.length === 0) {
        Text('分类加载中')
          .fontSize(13)
          .fontColor(Colors.textMuted)
          .height(80)
      }
    }
    .width(164)
    .height('100%')
    .padding({ left: 12, right: 12, top: 14 })
    .backgroundColor('#FBFCFE')
    .borderRadius(18)
  }
}
