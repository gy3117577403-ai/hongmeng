import { Colors } from '../constants/colors';

@Component
export struct CommonButton {
  label: string = '';
  primary: boolean = true;
  danger: boolean = false;
  enabled: boolean = true;
  onTap: () => void = () => {};

  build() {
    Button(this.label)
      .height(48)
      .padding({ left: 20, right: 20 })
      .fontSize(16)
      .fontColor(this.primary || this.danger ? Color.White : Colors.text)
      .backgroundColor(this.danger ? Colors.danger : (this.primary ? Colors.primary : Colors.card))
      .border({ width: this.primary || this.danger ? 0 : 1, color: Colors.border })
      .borderRadius(14)
      .enabled(this.enabled)
      .opacity(this.enabled ? 1 : 0.48)
      .onClick(() => this.onTap())
  }
}
