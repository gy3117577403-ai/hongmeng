import router from '@ohos.router';
import type common from '@ohos.app.ability.common';
import { API_BASE_URL } from '../constants/api';
import { Colors } from '../constants/colors';
import { CommonButton } from '../components/CommonButton';
import { ClipboardAdapter } from '../platform/ClipboardAdapter';
import { ToastAdapter } from '../platform/ToastAdapter';
import { ApiException } from '../services/httpClient';
import * as adminApi from '../services/adminApi';
import type { ChangeSnapshotItem, DiagnosticsData, NativeUserAccount, OperationLogItem, TrashData } from '../services/adminApi';
import * as systemApi from '../services/systemApi';
import { AuthStore } from '../stores/AuthStore';
import { NavigationStore } from '../stores/NavigationStore';
import type { ConnectorParameter } from '../models/ConnectorParameter';
import type { ResourceFile } from '../models/ResourceFile';
import type { WorkOrder } from '../models/WorkOrder';

@Entry
@Component
struct SettingsPage {
  @State loading: boolean = false;
  @State activePanel: string = 'stability';
  @State statusText: string = '未检查';
  @State databaseText: string = '-';
  @State storageText: string = '-';
  @State countText: string = '-';
  @State warningText: string = '-';
  @State users: NativeUserAccount[] = [];
  @State logs: OperationLogItem[] = [];
  @State snapshots: ChangeSnapshotItem[] = [];
  @State trashWorkOrders: WorkOrder[] = [];
  @State trashResourceFiles: ResourceFile[] = [];
  @State trashConnectorParameters: ConnectorParameter[] = [];
  @State trashWorkOrderCount: number = 0;
  @State trashFileCount: number = 0;
  @State trashConnectorCount: number = 0;
  @State diagnosticsText: string = '-';
  @State diagnosticsJsonText: string = '';
  @State newUsername: string = '';
  @State newDisplayName: string = '';
  @State newPassword: string = '';
  @State resetPasswordText: string = '';
  @State currentPassword: string = '';
  @State changeNewPassword: string = '';
  @State changeConfirmPassword: string = '';
  @State pendingToggleUser?: NativeUserAccount = undefined;
  @State pendingResetUser?: NativeUserAccount = undefined;

  async aboutToAppear(): Promise<void> {
    await this.switchPanel(NavigationStore.consumeSettingsPanel());
  }

  async handleError(err: Error, fallback: string): Promise<void> {
    if (err instanceof ApiException && err.needLogin) {
      const context = getContext(this) as common.UIAbilityContext;
      await AuthStore.handleUnauthorized(context);
      return;
    }
    ToastAdapter.error(err.message || fallback);
  }

  async loadStatus(): Promise<void> {
    this.loading = true;
    try {
      const status = await systemApi.fetchSystemStatus();
      this.statusText = status.ok ? '正常' : '异常';
      this.databaseText = `${status.database.type} · ${status.database.ok ? '正常' : '异常'} · ${status.database.latencyMs}ms`;
      this.storageText = `${status.storage.type} · ${status.storage.ok ? '正常' : '异常'} · ${status.storage.latencyMs}ms`;
      this.countText = `工单 ${status.counts.workOrders || 0} · 文件 ${status.counts.resourceFiles || 0} · 连接器 ${status.counts.connectorParameters || 0}`;
      this.warningText = status.warnings.length ? status.warnings.join('；') : '暂无';
    } catch (err) {
      await this.handleError(err as Error, '系统状态加载失败');
      this.statusText = '检查失败';
    } finally {
      this.loading = false;
    }
  }

  async switchPanel(panel: string): Promise<void> {
    this.activePanel = panel;
    if (panel === 'stability') await this.loadStatus();
    if (panel === 'status') await this.loadStatus();
    if (panel === 'users') await this.loadUsers();
    if (panel === 'logs') await this.loadLogs();
    if (panel === 'trash') await this.loadTrash();
    if (panel === 'snapshots') await this.loadSnapshots();
    if (panel === 'diagnostics') await this.loadDiagnostics();
  }

  async loadUsers(): Promise<void> {
    this.loading = true;
    try {
      this.users = await adminApi.fetchUsers();
    } catch (err) {
      await this.handleError(err as Error, '账号列表加载失败');
    } finally {
      this.loading = false;
    }
  }

  async createUser(): Promise<void> {
    if (!this.newUsername || this.newPassword.length < 6) {
      ToastAdapter.error('请填写账号和至少 6 位初始密码');
      return;
    }
    try {
      await adminApi.createUser({ username: this.newUsername, displayName: this.newDisplayName, password: this.newPassword });
      this.newUsername = '';
      this.newDisplayName = '';
      this.newPassword = '';
      await this.loadUsers();
      ToastAdapter.success('账号已新增');
    } catch (err) {
      await this.handleError(err as Error, '新增账号失败');
    }
  }

  requestToggleUser(user: NativeUserAccount): void {
    this.pendingToggleUser = user;
  }

  async confirmToggleUser(): Promise<void> {
    const user = this.pendingToggleUser;
    if (user === undefined) return;
    try {
      await adminApi.updateUser(user.id, { isActive: !user.isActive, confirmText: user.isActive ? 'DISABLE' : 'ENABLE' });
      this.pendingToggleUser = undefined;
      await this.loadUsers();
      ToastAdapter.success(user.isActive ? '账号已禁用' : '账号已启用');
    } catch (err) {
      await this.handleError(err as Error, '账号状态保存失败');
    }
  }

  requestResetPassword(user: NativeUserAccount): void {
    if (this.resetPasswordText.length < 6) {
      ToastAdapter.error('请先填写至少 6 位的新密码');
      return;
    }
    this.pendingResetUser = user;
  }

  async confirmResetPassword(): Promise<void> {
    const user = this.pendingResetUser;
    if (user === undefined) return;
    try {
      await adminApi.resetUserPassword(user.id, { password: this.resetPasswordText, confirmText: 'RESET_PASSWORD' });
      this.pendingResetUser = undefined;
      this.resetPasswordText = '';
      ToastAdapter.success(`已重置 ${user.username} 的密码`);
    } catch (err) {
      await this.handleError(err as Error, '重置密码失败');
    }
  }

  async changePassword(): Promise<void> {
    try {
      await adminApi.changePassword({
        currentPassword: this.currentPassword,
        newPassword: this.changeNewPassword,
        confirmPassword: this.changeConfirmPassword
      });
      ToastAdapter.success('密码修改成功，请重新登录');
      await this.logout();
    } catch (err) {
      await this.handleError(err as Error, '修改密码失败');
    }
  }

  async loadLogs(): Promise<void> {
    this.loading = true;
    try {
      this.logs = await adminApi.fetchOperationLogs();
    } catch (err) {
      await this.handleError(err as Error, '操作日志加载失败');
    } finally {
      this.loading = false;
    }
  }

  async loadTrash(): Promise<void> {
    this.loading = true;
    try {
      const trash: TrashData = await adminApi.fetchTrash();
      const connectorParameters: ConnectorParameter[] = trash.connectorParameters || [];
      this.trashWorkOrders = trash.workOrders;
      this.trashResourceFiles = trash.resourceFiles;
      this.trashConnectorParameters = connectorParameters;
      this.trashWorkOrderCount = trash.workOrders.length;
      this.trashFileCount = trash.resourceFiles.length;
      this.trashConnectorCount = connectorParameters.length;
    } catch (err) {
      await this.handleError(err as Error, '回收站加载失败');
    } finally {
      this.loading = false;
    }
  }

  async loadSnapshots(): Promise<void> {
    this.loading = true;
    try {
      this.snapshots = await adminApi.fetchSnapshots();
    } catch (err) {
      await this.handleError(err as Error, '变更快照加载失败');
    } finally {
      this.loading = false;
    }
  }

  async restoreWorkOrder(item: WorkOrder): Promise<void> {
    try {
      await adminApi.restoreWorkOrder(item.id);
      await this.loadTrash();
      ToastAdapter.success('工单已恢复');
    } catch (err) {
      await this.handleError(err as Error, '工单恢复失败');
    }
  }

  async restoreResourceFile(item: ResourceFile): Promise<void> {
    try {
      await adminApi.restoreResourceFile(item.id);
      await this.loadTrash();
      ToastAdapter.success('文件已恢复');
    } catch (err) {
      await this.handleError(err as Error, '文件恢复失败');
    }
  }

  async restoreConnectorParameter(item: ConnectorParameter): Promise<void> {
    try {
      await adminApi.restoreConnectorParameter(item.id);
      await this.loadTrash();
      ToastAdapter.success('连接器参数已恢复');
    } catch (err) {
      await this.handleError(err as Error, '连接器参数恢复失败');
    }
  }

  async loadDiagnostics(): Promise<void> {
    this.loading = true;
    try {
      const diagnostics: DiagnosticsData = await adminApi.fetchDiagnostics();
      this.diagnosticsText = `${diagnostics.exportedAt} · 数据库 ${diagnostics.health.database} · 最近日志 ${diagnostics.recentLogs.length}`;
      this.diagnosticsJsonText = JSON.stringify(diagnostics);
    } catch (err) {
      await this.handleError(err as Error, '诊断信息加载失败');
    } finally {
      this.loading = false;
    }
  }

  copyDiagnostics(): void {
    if (this.diagnosticsJsonText.length === 0) {
      ToastAdapter.show('请先刷新诊断信息');
      return;
    }
    ClipboardAdapter.copyText(this.diagnosticsJsonText, '诊断信息');
  }

  async logout(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    await AuthStore.logout(context);
    router.replaceUrl({ url: 'pages/LoginPage' });
  }

  @Builder
  navButton(label: string, panel: string): void {
    Button(label)
      .height(42)
      .width('100%')
      .fontSize(14)
      .fontColor(this.activePanel === panel ? Color.White : Colors.text)
      .backgroundColor(this.activePanel === panel ? Colors.primary : Colors.card)
      .border({ width: 1, color: this.activePanel === panel ? Colors.primary : Colors.border })
      .borderRadius(12)
      .margin({ bottom: 10 })
      .onClick(() => this.switchPanel(panel))
  }

  @Builder
  sectionTitle(title: string, subtitle: string): void {
    Column() {
      Text(title)
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .fontColor(Colors.text)
      Text(subtitle)
        .fontSize(13)
        .fontColor(Colors.textMuted)
        .margin({ top: 4 })
    }
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: 16 })
  }

  build(): void {
    Stack() {
      Column() {
        Row() {
          Button('返回')
            .height(44)
            .fontSize(15)
            .backgroundColor(Colors.primaryLight)
            .fontColor(Colors.primary)
            .borderRadius(12)
            .onClick(() => router.back())
          Text('系统设置')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.text)
            .margin({ left: 18 })
          Blank()
          CommonButton({ label: '退出登录', danger: true, onTap: () => this.logout() })
        }
        .height(72)
        .padding({ left: 24, right: 24 })
        .backgroundColor(Colors.card)

        Row() {
        Column() {
          this.navButton('生产稳定', 'stability')
          this.navButton('系统状态', 'status')
          this.navButton('账号管理', 'users')
          this.navButton('修改密码', 'password')
          this.navButton('操作日志', 'logs')
          this.navButton('回收站', 'trash')
          this.navButton('变更快照', 'snapshots')
          this.navButton('诊断信息', 'diagnostics')
        }
        .width(168)
        .height('100%')
        .padding(16)
        .backgroundColor('#FBFCFE')
        .borderRadius(18)

        Column() {
          if (this.activePanel === 'stability') {
            this.sectionTitle('生产稳定中心', '聚合健康状态、风险提示和现场排查入口。')
            Row() {
              Column() {
                Text('服务状态')
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                Text(this.statusText)
                  .fontSize(24)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.statusText === '正常' ? Colors.success : Colors.danger)
                  .margin({ top: 8 })
              }
              .layoutWeight(1)
              .padding(16)
              .backgroundColor('#F9FAFB')
              .borderRadius(16)
              .margin({ right: 12 })
              Column() {
                Text('数据库')
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                Text(this.databaseText)
                  .fontSize(15)
                  .fontColor(Colors.text)
                  .margin({ top: 8 })
              }
              .layoutWeight(1)
              .padding(16)
              .backgroundColor('#F9FAFB')
              .borderRadius(16)
              .margin({ right: 12 })
              Column() {
                Text('对象存储')
                  .fontSize(13)
                  .fontColor(Colors.textMuted)
                Text(this.storageText)
                  .fontSize(15)
                  .fontColor(Colors.text)
                  .margin({ top: 8 })
              }
              .layoutWeight(1)
              .padding(16)
              .backgroundColor('#F9FAFB')
              .borderRadius(16)
            }
            .margin({ bottom: 14 })
            Column() {
              Text(this.countText)
                .fontSize(15)
                .fontColor(Colors.text)
              Text(`风险提示：${this.warningText}`)
                .fontSize(13)
                .fontColor(Colors.textMuted)
                .margin({ top: 8 })
              Text(`API：${API_BASE_URL}`)
                .fontSize(12)
                .fontColor(Colors.textMuted)
                .margin({ top: 8 })
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFDFB')
            .border({ width: 1, color: Colors.border })
            .borderRadius(16)
            .margin({ bottom: 16 })
            Row() {
              CommonButton({ label: this.loading ? '检查中' : '刷新状态', primary: false, isEnabled: !this.loading, onTap: () => this.loadStatus() })
                .width(180)
              CommonButton({ label: '查看操作日志', primary: false, onTap: () => this.switchPanel('logs') })
                .width(180)
                .margin({ left: 12 })
              CommonButton({ label: '查看回收站', primary: false, onTap: () => this.switchPanel('trash') })
                .width(180)
                .margin({ left: 12 })
              CommonButton({ label: '导出诊断', onTap: () => this.switchPanel('diagnostics') })
                .width(180)
                .margin({ left: 12 })
            }
          }

          if (this.activePanel === 'status') {
            this.sectionTitle('系统状态', '检查服务、数据库、对象存储和业务数据量。')
            Text(`服务器：${API_BASE_URL}`).fontSize(14).fontColor(Colors.textMuted).margin({ bottom: 12 })
            Text(`当前用户：${AuthStore.user?.displayName || AuthStore.user?.username || '-'}`).fontSize(14).fontColor(Colors.textMuted).margin({ bottom: 12 })
            Text(`状态：${this.statusText}`).fontSize(16).fontColor(this.statusText === '正常' ? Colors.success : Colors.danger).margin({ bottom: 10 })
            Text(this.databaseText).fontSize(14).fontColor(Colors.textMuted).margin({ bottom: 8 })
            Text(this.storageText).fontSize(14).fontColor(Colors.textMuted).margin({ bottom: 8 })
            Text(this.countText).fontSize(14).fontColor(Colors.textMuted).margin({ bottom: 8 })
            Text(`提示：${this.warningText}`).fontSize(13).fontColor(Colors.textMuted).margin({ bottom: 18 })
            CommonButton({ label: this.loading ? '检查中' : '刷新系统状态', primary: false, isEnabled: !this.loading, onTap: () => this.loadStatus() }).width(220)
          }

          if (this.activePanel === 'users') {
            this.sectionTitle('账号管理', '所有登录账号共享同一套生产资料数据。')
            Row() {
              TextInput({ placeholder: '账号', text: this.newUsername }).height(42).layoutWeight(1).onChange(value => this.newUsername = value)
              TextInput({ placeholder: '显示名', text: this.newDisplayName }).height(42).layoutWeight(1).margin({ left: 10 }).onChange(value => this.newDisplayName = value)
              TextInput({ placeholder: '初始密码', text: this.newPassword }).height(42).layoutWeight(1).margin({ left: 10 }).type(InputType.Password).onChange(value => this.newPassword = value)
              CommonButton({ label: '新增账号', onTap: () => this.createUser() }).margin({ left: 10 })
            }
            .margin({ bottom: 14 })
            Row() {
              Text('重置密码新值')
                .fontSize(13)
                .fontColor(Colors.textMuted)
              TextInput({ placeholder: '输入至少 6 位新密码后，再点击账号行的重置密码', text: this.resetPasswordText })
                .height(42)
                .layoutWeight(1)
                .margin({ left: 10 })
                .type(InputType.Password)
                .onChange(value => this.resetPasswordText = value)
            }
            .margin({ bottom: 14 })
            ForEach(this.users, (user: NativeUserAccount) => {
              Row() {
                Column() {
                  Text(`${user.displayName} · ${user.username}`).fontSize(15).fontWeight(FontWeight.Medium).fontColor(Colors.text)
                  Text(user.isActive ? '启用' : '禁用').fontSize(12).fontColor(user.isActive ? Colors.success : Colors.danger).margin({ top: 4 })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                CommonButton({ label: user.isActive ? '禁用' : '启用', primary: false, onTap: () => this.requestToggleUser(user) }).margin({ right: 8 })
                CommonButton({ label: '重置密码', primary: false, onTap: () => this.requestResetPassword(user) })
              }
              .padding(12)
              .margin({ bottom: 8 })
              .backgroundColor('#F9FAFB')
              .borderRadius(14)
            })
          }

          if (this.activePanel === 'password') {
            this.sectionTitle('修改密码', '修改成功后会自动退出登录。')
            TextInput({ placeholder: '当前密码', text: this.currentPassword }).height(46).type(InputType.Password).onChange(value => this.currentPassword = value)
            TextInput({ placeholder: '新密码', text: this.changeNewPassword }).height(46).type(InputType.Password).margin({ top: 12 }).onChange(value => this.changeNewPassword = value)
            TextInput({ placeholder: '确认新密码', text: this.changeConfirmPassword }).height(46).type(InputType.Password).margin({ top: 12, bottom: 18 }).onChange(value => this.changeConfirmPassword = value)
            CommonButton({ label: '保存新密码', onTap: () => this.changePassword() }).width(220)
          }

          if (this.activePanel === 'logs') {
            this.sectionTitle('操作日志', '最近 100 条操作记录，不显示敏感信息。')
            ForEach(this.logs, (log: OperationLogItem) => {
              Text(`${log.createdAt} · ${log.user} · ${log.action} · ${log.detailSummary}`)
                .fontSize(13)
                .fontColor(Colors.text)
                .padding(10)
                .margin({ bottom: 8 })
                .backgroundColor('#F9FAFB')
                .borderRadius(12)
            })
          }

          if (this.activePanel === 'trash') {
            this.sectionTitle('回收站', '软删除记录仍保留在 PostgreSQL 和对象存储中。')
            Text(`已删除工单：${this.trashWorkOrderCount}`).fontSize(16).fontColor(Colors.text).margin({ bottom: 10 })
            Text(`已删除文件：${this.trashFileCount}`).fontSize(16).fontColor(Colors.text).margin({ bottom: 18 })
            Text(`已删除连接器参数：${this.trashConnectorCount}`).fontSize(16).fontColor(Colors.text).margin({ bottom: 18 })
            CommonButton({ label: this.loading ? '刷新中' : '刷新回收站', primary: false, isEnabled: !this.loading, onTap: () => this.loadTrash() }).width(220)
            Row() {
              Column() {
                Text('已删除工单')
                  .fontSize(16)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Colors.text)
                Scroll() {
                  Column() {
                    ForEach(this.trashWorkOrders, (item: WorkOrder) => {
                      Row() {
                        Column() {
                          Text(item.code)
                            .fontSize(14)
                            .fontColor(Colors.text)
                            .fontWeight(FontWeight.Medium)
                          Text(item.productName || '-')
                            .fontSize(12)
                            .fontColor(Colors.textMuted)
                            .margin({ top: 4 })
                        }
                        .alignItems(HorizontalAlign.Start)
                        .layoutWeight(1)
                        CommonButton({ label: '恢复', primary: false, onTap: () => this.restoreWorkOrder(item) })
                      }
                      .padding(10)
                      .margin({ top: 8 })
                      .backgroundColor('#F9FAFB')
                      .borderRadius(12)
                    })
                  }
                }
                .height(210)
              }
              .layoutWeight(1)
              .margin({ right: 12 })
              Column() {
                Text('已删除文件')
                  .fontSize(16)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Colors.text)
                Scroll() {
                  Column() {
                    ForEach(this.trashResourceFiles, (item: ResourceFile) => {
                      Row() {
                        Column() {
                          Text(item.displayName || item.originalName)
                            .fontSize(14)
                            .fontColor(Colors.text)
                            .fontWeight(FontWeight.Medium)
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                          Text(item.categoryName || '-')
                            .fontSize(12)
                            .fontColor(Colors.textMuted)
                            .margin({ top: 4 })
                        }
                        .alignItems(HorizontalAlign.Start)
                        .layoutWeight(1)
                        CommonButton({ label: '恢复', primary: false, onTap: () => this.restoreResourceFile(item) })
                      }
                      .padding(10)
                      .margin({ top: 8 })
                      .backgroundColor('#F9FAFB')
                      .borderRadius(12)
                    })
                  }
                }
                .height(210)
              }
              .layoutWeight(1)
            }
            .margin({ top: 16 })
            Column() {
              Text('已删除连接器参数')
                .fontSize(16)
                .fontWeight(FontWeight.Bold)
                .fontColor(Colors.text)
              Scroll() {
                Column() {
                  ForEach(this.trashConnectorParameters, (item: ConnectorParameter) => {
                    Row() {
                      Column() {
                        Text(item.model || '-')
                          .fontSize(14)
                          .fontColor(Colors.text)
                          .fontWeight(FontWeight.Medium)
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                        Text(item.remark || '无备注')
                          .fontSize(12)
                          .fontColor(Colors.textMuted)
                          .margin({ top: 4 })
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                      }
                      .alignItems(HorizontalAlign.Start)
                      .layoutWeight(1)
                      CommonButton({ label: '恢复', primary: false, onTap: () => this.restoreConnectorParameter(item) })
                    }
                    .padding(10)
                    .margin({ top: 8 })
                    .backgroundColor('#F9FAFB')
                    .borderRadius(12)
                  })
                }
              }
              .height(180)
            }
            .margin({ top: 16 })
          }

          if (this.activePanel === 'snapshots') {
            this.sectionTitle('数据变更快照', '记录关键数据变化，方便回溯。')
            ForEach(this.snapshots, (snapshot: ChangeSnapshotItem) => {
              Text(`${snapshot.createdAt} · ${snapshot.entityType} · ${snapshot.action} · ${snapshot.summary}`)
                .fontSize(13)
                .fontColor(Colors.text)
                .padding(10)
                .margin({ bottom: 8 })
                .backgroundColor('#F9FAFB')
                .borderRadius(12)
            })
          }

          if (this.activePanel === 'diagnostics') {
            this.sectionTitle('诊断信息导出', '用于现场排查系统健康和最近操作。')
            Text(this.diagnosticsText).fontSize(14).fontColor(Colors.textMuted).margin({ bottom: 18 })
            Row() {
              CommonButton({ label: this.loading ? '导出中' : '刷新诊断信息', primary: false, isEnabled: !this.loading, onTap: () => this.loadDiagnostics() })
                .width(220)
              CommonButton({ label: '复制诊断 JSON', primary: false, onTap: () => this.copyDiagnostics() })
                .width(220)
                .margin({ left: 12 })
            }
          }
        }
        .layoutWeight(1)
        .height('100%')
        .padding(24)
        .margin({ left: 16 })
        .backgroundColor(Colors.card)
        .borderRadius(18)
        }
        .padding(16)
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')

      if (this.pendingToggleUser) {
        Column() {
          Text(this.pendingToggleUser?.isActive === true ? '确认禁用账号' : '确认启用账号')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.pendingToggleUser?.isActive === true ? Colors.danger : Colors.text)
          Text(this.pendingToggleUser?.isActive === true
            ? `将禁用账号 ${this.pendingToggleUser?.username || '-'}，该账号将不能继续登录。`
            : `将启用账号 ${this.pendingToggleUser?.username || '-'}，该账号可重新登录。`)
            .fontSize(15)
            .fontColor(Colors.textMuted)
            .textAlign(TextAlign.Center)
            .margin({ top: 12, bottom: 18 })
          Row() {
            CommonButton({
              label: this.pendingToggleUser?.isActive === true ? '确认禁用' : '确认启用',
              danger: this.pendingToggleUser?.isActive === true,
              onTap: () => this.confirmToggleUser()
            })
              .margin({ right: 12 })
            CommonButton({ label: '取消', primary: false, onTap: () => this.pendingToggleUser = undefined })
          }
        }
        .width(440)
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }

      if (this.pendingResetUser) {
        Column() {
          Text('确认重置密码')
            .fontSize(22)
            .fontWeight(FontWeight.Bold)
            .fontColor(Colors.danger)
          Text(`将重置账号 ${this.pendingResetUser?.username || '-'} 的登录密码，操作日志不会记录明文密码。`)
            .fontSize(15)
            .fontColor(Colors.textMuted)
            .textAlign(TextAlign.Center)
            .margin({ top: 12, bottom: 18 })
          Row() {
            CommonButton({ label: '确认重置', danger: true, onTap: () => this.confirmResetPassword() })
              .margin({ right: 12 })
            CommonButton({ label: '取消', primary: false, onTap: () => this.pendingResetUser = undefined })
          }
        }
        .width(460)
        .padding(24)
        .backgroundColor(Colors.card)
        .borderRadius(18)
        .shadow({ radius: 24, color: '#22000000', offsetY: 8 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Colors.bg)
  }
}
