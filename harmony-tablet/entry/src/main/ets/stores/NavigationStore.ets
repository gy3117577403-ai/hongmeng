export class NavigationStore {
  static settingsPanel: string = 'stability';

  static openSettings(panel: string): void {
    NavigationStore.settingsPanel = panel;
  }

  static consumeSettingsPanel(): string {
    const panel = NavigationStore.settingsPanel;
    NavigationStore.settingsPanel = 'stability';
    return panel;
  }
}
