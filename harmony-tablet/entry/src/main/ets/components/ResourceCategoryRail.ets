import { Colors } from '../constants/colors';
import type { ResourceCategory } from '../models/ResourceCategory';

@Component
export struct ResourceCategoryRail {
  categories: ResourceCategory[] = [];
  selectedId: string = '';
  onSelect: (category: ResourceCategory) => void = () => {};

  build(): void {
    Column() {
      ForEach(this.categories, (category: ResourceCategory) => {
        Column() {
          Text(category.name)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(category.id === this.selectedId ? Colors.primary : Colors.text)
            .textAlign(TextAlign.Center)
            .maxLines(2)
          Text(`${category.fileCount || 0} 个`)
            .fontSize(12)
            .fontColor(Colors.textMuted)
            .margin({ top: 6 })
        }
        .height(74)
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .margin({ bottom: 10 })
        .backgroundColor(category.id === this.selectedId ? Colors.primaryLight : Colors.card)
        .border({ width: 1, color: category.id === this.selectedId ? Colors.primary : Colors.border })
        .borderRadius(14)
        .onClick(() => this.onSelect(category))
      })
    }
    .width(142)
    .padding({ left: 12, right: 12, top: 12 })
    .backgroundColor(Colors.bg)
  }
}
