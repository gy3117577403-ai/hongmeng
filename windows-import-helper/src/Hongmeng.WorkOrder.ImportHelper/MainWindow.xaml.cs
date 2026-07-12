using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Windows.Input;
using System.Windows.Threading;
using Hongmeng.WorkOrder.ImportHelper.Models;
using Hongmeng.WorkOrder.ImportHelper.Services;
using Microsoft.Win32;

namespace Hongmeng.WorkOrder.ImportHelper;

public partial class MainWindow : Window
{
    private readonly SingleInstanceCoordinator _coordinator;
    private readonly ProtocolRegistrationService _protocolRegistration;
    private readonly ProtocolRegistrationStatus _startupRegistrationStatus;
    private readonly string? _initialArgument;
    private readonly LoopbackHandoffServer _handoffServer = new();
    private readonly TaskApiClient _api;
    private readonly string _helperInstanceId;
    private readonly FileValidator _validator = new();
    private readonly DownloadFolderMonitor _monitor = new();
    private readonly UserSettingsStore _settingsStore = new();
    private readonly CancellationTokenSource _lifetime = new();
    private readonly AsyncPauseGate _pauseGate = new();
    private readonly SemaphoreSlim _uploadRunLock = new(1, 1);
    private readonly SemaphoreSlim _taskConnectionLock = new(1, 1);
    private readonly DispatcherTimer _expiryTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    private CancellationTokenSource? _uploadCancellation;
    private TaskDetails? _task;
    private Uri _activeBaseUrl = new(AppConstants.DefaultBaseUrl);
    private bool _taskExpired;
    private bool _uploadRerunRequested;
    private string _lastError = "";
    private string _connectionState = "未连接";

    public ObservableCollection<FileQueueItem> QueueItems { get; } = [];

    public MainWindow(
        SingleInstanceCoordinator coordinator,
        ProtocolRegistrationService protocolRegistration,
        ProtocolRegistrationStatus startupRegistrationStatus,
        string? initialArgument)
    {
        _helperInstanceId = new HelperInstanceIdentity().GetOrCreate();
        _api = new TaskApiClient(_helperInstanceId);
        InitializeComponent();
        DataContext = this;
        _coordinator = coordinator;
        _protocolRegistration = protocolRegistration;
        _startupRegistrationStatus = startupRegistrationStatus;
        _initialArgument = initialArgument;
        _coordinator.LaunchArgumentReceived += OnLaunchArgumentReceived;
        _handoffServer.HandoffReceived += OnHandoffReceived;
        _monitor.FileDetected += OnMonitorFileDetected;
        _expiryTimer.Tick += OnExpiryTick;
        var settings = _settingsStore.Load();
        DownloadFolderText.Text = settings.DownloadFolder;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs eventArgs)
    {
        ApplyProtocolStatus(_startupRegistrationStatus);
        UpdateDiagnostics();
        try
        {
            await _handoffServer.StartAsync(_lifetime.Token);
            if (!string.IsNullOrWhiteSpace(_initialArgument)) ProcessLaunchArgument(_initialArgument);
        }
        catch (Exception error)
        {
            SetError($"本地安全交接服务启动失败：{error.Message}");
        }
    }

    private void OnLaunchArgumentReceived(string? argument)
    {
        _ = Dispatcher.InvokeAsync(() => ProcessLaunchArgument(argument));
    }

    private void ProcessLaunchArgument(string? argument)
    {
        if (!LaunchRequestParser.TryParseActivation(argument, out var activation) || activation is null)
        {
            SetError("无效或过期的导入任务");
            return;
        }
        BringWindowToFront();
        if (activation.Kind == ProtocolActivationKind.Activate)
        {
            SetStatus("助手已激活。");
            return;
        }
        if (activation.Kind == ProtocolActivationKind.Ping)
        {
            SetStatus("浏览器协议测试成功");
            return;
        }

        var request = activation.LaunchRequest;
        if (request is null)
        {
            SetError("无效或过期的导入任务");
            return;
        }
        _activeBaseUrl = request.BaseUrl;
        _handoffServer.Expect(request);
        SetStatus("已收到网页任务，正在等待浏览器完成安全票据交接...");
        _connectionState = "等待安全交接";
        UpdateDiagnostics();
    }

    private void BringWindowToFront()
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Show();
        Activate();
        Topmost = true;
        Topmost = false;
        Focus();
    }

    private void OnHandoffReceived(HandoffPayload payload)
    {
        _ = Dispatcher.InvokeAsync(async () => await AcceptHandoffAsync(payload));
    }

    private async Task AcceptHandoffAsync(HandoffPayload payload)
    {
        await _taskConnectionLock.WaitAsync(_lifetime.Token);
        try
        {
            var baseUrl = ServiceOriginPolicy.NormalizeOrigin(payload.BaseUrl);
            var connected = await _api.ConnectAsync(baseUrl, payload.TaskId, payload.Ticket, _lifetime.Token);
            ApplyConnectedTask(baseUrl, payload.TaskId, connected);
        }
        catch (Exception error)
        {
            SetError($"任务连接失败：{FriendlyError(error)}");
        }
        finally
        {
            _taskConnectionLock.Release();
        }
    }

    private void ApplyConnectedTask(Uri baseUrl, string expectedTaskId, ConnectTaskResult connected)
    {
        var normalizedBaseUrl = ServiceOriginPolicy.NormalizeOrigin(baseUrl);
        var task = connected.Task;
        if (!task.TaskId.Equals(expectedTaskId, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("任务编号不匹配");
        if (string.IsNullOrWhiteSpace(connected.Ticket)) throw new InvalidOperationException("服务器未返回绑定后的任务票据");

        _api.Configure(normalizedBaseUrl, task.TaskId, connected.Ticket);
        _task = task;
        _activeBaseUrl = normalizedBaseUrl;
        _taskExpired = task.ExpiresAt <= DateTimeOffset.Now;
        _lastError = "";
        _connectionState = _taskExpired ? "任务已过期" : "助手已连接";
        QueueItems.Clear();
        _monitor.Stop();
        MonitorButton.Content = "开始监控";
        MonitorStatusText.Text = "未启动";
        UpdateTaskHeader();
        UpdateQueueSummary();
        _expiryTimer.Start();
        PairingCodeText.Clear();
        SetStatus(_taskExpired ? "任务已过期，请在网页重新创建。" : "助手已连接。可拖入、粘贴文件，或启动下载目录监控。");
    }

    private void ApplyPairedTask(Uri baseUrl, PairTaskResult paired)
    {
        ApplyConnectedTask(baseUrl, paired.TaskId, new ConnectTaskResult
        {
            Ticket = paired.Ticket,
            AlreadyConnected = paired.AlreadyConnected,
            Task = paired.Task,
        });
    }

    private void UpdateTaskHeader()
    {
        CustomerText.Text = _task?.WorkOrder.CustomerName ?? "等待网页任务";
        SpecificationText.Text = _task?.WorkOrder.DisplayCode ?? "-";
        SpecificationText.ToolTip = _task?.WorkOrder.DisplayCode;
        CategoryText.Text = _task?.Category.Name ?? "-";
        ExpiryText.Text = _task is null ? "-" : RemainingLabel(_task.ExpiresAt - DateTimeOffset.Now);
    }

    private void OnExpiryTick(object? sender, EventArgs eventArgs)
    {
        if (_task is null) return;
        var remaining = _task.ExpiresAt - DateTimeOffset.Now;
        ExpiryText.Text = RemainingLabel(remaining);
        if (remaining > TimeSpan.Zero || _taskExpired) return;
        _taskExpired = true;
        _monitor.Stop();
        MonitorButton.Content = "开始监控";
        MonitorStatusText.Text = "任务已过期，监控已停止";
        _uploadCancellation?.Cancel();
        _api.Clear();
        _connectionState = "任务已过期";
        SetStatus("任务已过期，请回到网页为当前工单重新创建导入任务。");
    }

    private static string RemainingLabel(TimeSpan remaining)
    {
        if (remaining <= TimeSpan.Zero) return "已过期";
        return $"{Math.Floor(remaining.TotalMinutes):00}:{remaining.Seconds:00}";
    }

    private async void OnChooseFiles(object sender, RoutedEventArgs eventArgs)
    {
        var dialog = new OpenFileDialog
        {
            Multiselect = true,
            Filter = "生产资料|*.pdf;*.jpg;*.jpeg;*.png;*.webp|PDF|*.pdf|图片|*.jpg;*.jpeg;*.png;*.webp"
        };
        if (dialog.ShowDialog(this) == true) await AddFilesAsync(dialog.FileNames, true);
    }

    private void OnFilesDragged(object sender, DragEventArgs eventArgs)
    {
        eventArgs.Effects = eventArgs.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Copy : DragDropEffects.None;
        eventArgs.Handled = true;
    }

    private async void OnFilesDropped(object sender, DragEventArgs eventArgs)
    {
        eventArgs.Handled = true;
        if (eventArgs.Data.GetData(DataFormats.FileDrop) is string[] paths && paths.Length > 0)
        {
            await AddFilesAsync(paths.Where(File.Exists), true);
            return;
        }
        SetStatus("未收到真实文件，请改用微盘下载目录监控；助手不会抓取文本或私有链接。");
    }

    private async void OnPreviewKeyDown(object sender, KeyEventArgs eventArgs)
    {
        if (eventArgs.Key != Key.V || Keyboard.Modifiers != ModifierKeys.Control) return;
        eventArgs.Handled = true;
        try
        {
            if (Clipboard.ContainsFileDropList())
            {
                var files = Clipboard.GetFileDropList().Cast<string>().Where(File.Exists).ToArray();
                await AddFilesAsync(files, true);
                return;
            }
            SetStatus("剪贴板中没有真实文件。文本、链接和纯位图不会被自动下载或上传。");
        }
        catch (Exception error)
        {
            SetStatus($"读取文件剪贴板失败：{error.Message}");
        }
    }

    private async Task AddFilesAsync(IEnumerable<string> paths, bool autoUpload)
    {
        if (!EnsureActiveTask()) return;
        var distinct = paths.Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (distinct.Length == 0)
        {
            SetStatus("没有收到可读取的真实文件。");
            return;
        }

        foreach (var path in distinct)
        {
            if (_task is null || _taskExpired) break;
            if (QueueItems.Any(item => item.Path.Equals(path, StringComparison.OrdinalIgnoreCase))) continue;
            if (QueueItems.Count >= _task.Limits.MaxFiles)
            {
                SetStatus($"当前任务最多接收 {_task.Limits.MaxFiles} 个文件。");
                break;
            }

            var item = new FileQueueItem { Path = path, FileName = Path.GetFileName(path), Status = "正在校验" };
            QueueItems.Add(item);
            UpdateQueueSummary();
            try
            {
                var validation = await _validator.ValidateAsync(path, _task.Limits.MaxFileBytes, _lifetime.Token);
                if (!validation.IsValid)
                {
                    item.Status = "校验失败";
                    item.Message = validation.Error;
                    continue;
                }
                item.Size = validation.Size;
                item.MimeType = validation.MimeType;
                item.Sha256 = validation.Sha256;
                var queuedBytes = QueueItems
                    .Where(current => current != item && current.Status != "校验失败" && current.Status != "重复跳过")
                    .Sum(current => current.Size);
                if (queuedBytes + item.Size > _task.Limits.MaxTotalBytes)
                {
                    item.Status = "校验失败";
                    item.Message = "当前任务文件总大小超过限制";
                    continue;
                }
                var duplicate = await _api.CheckAsync(new DuplicateCheckRequest
                {
                    FileName = item.FileName,
                    Size = item.Size,
                    MimeType = item.MimeType,
                    Sha256 = item.Sha256
                }, _lifetime.Token);
                ApplyDuplicateResult(item, duplicate);
            }
            catch (Exception error)
            {
                item.Status = "校验失败";
                item.Message = FriendlyError(error);
            }
            finally
            {
                UpdateQueueSummary();
            }
        }

        if (autoUpload) await UploadPendingAsync();
    }

    private static void ApplyDuplicateResult(FileQueueItem item, DuplicateCheckResult result)
    {
        switch (result.Status)
        {
            case "duplicate":
                item.DuplicateStatus = "完全重复";
                item.Status = "重复跳过";
                item.Progress = 100;
                item.Message = "相同内容已存在，已跳过";
                break;
            case "new_version":
                item.DuplicateStatus = $"新版本 {result.SuggestedVersion}";
                item.Status = "等待上传";
                item.Message = "同名但内容不同，将作为新版本保存";
                break;
            case "conflict":
                item.DuplicateStatus = "需要确认";
                item.Status = "需要确认";
                item.Message = "同名同大小但无法确认哈希；勾选确认冲突后才可上传";
                break;
            default:
                item.DuplicateStatus = "新文件";
                item.Status = "等待上传";
                item.Message = "校验通过";
                break;
        }
    }

    private async void OnChooseDownloadFolder(object sender, RoutedEventArgs eventArgs)
    {
        var dialog = new OpenFolderDialog
        {
            Title = "选择企业微信微盘下载目录",
            InitialDirectory = Directory.Exists(DownloadFolderText.Text) ? DownloadFolderText.Text : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        if (dialog.ShowDialog(this) != true) return;
        DownloadFolderText.Text = dialog.FolderName;
        _settingsStore.Save(new HelperSettings { DownloadFolder = dialog.FolderName });
        if (_monitor.IsRunning)
        {
            _monitor.Start(dialog.FolderName);
            MonitorStatusText.Text = "正在监控新下载文件";
        }
        await Task.CompletedTask;
    }

    private void OnToggleMonitor(object sender, RoutedEventArgs eventArgs)
    {
        if (!EnsureActiveTask()) return;
        if (!_monitor.IsRunning)
        {
            if (!Directory.Exists(DownloadFolderText.Text))
            {
                SetStatus("请先选择有效的企业微信下载目录。");
                return;
            }
            try
            {
                _monitor.Start(DownloadFolderText.Text);
                MonitorButton.Content = "暂停监控";
                MonitorStatusText.Text = "正在监控新下载文件";
                SetStatus("下载目录监控已启动；不会处理启动前的旧文件。");
            }
            catch (Exception error)
            {
                SetStatus($"目录监控启动失败：{error.Message}");
            }
            return;
        }

        if (_monitor.IsPaused)
        {
            _monitor.Resume();
            MonitorButton.Content = "暂停监控";
            MonitorStatusText.Text = "正在监控新下载文件";
        }
        else
        {
            _monitor.Pause();
            MonitorButton.Content = "继续监控";
            MonitorStatusText.Text = "已暂停";
        }
    }

    private void OnMonitorFileDetected(string path)
    {
        _ = Dispatcher.InvokeAsync(async () => await AddFilesAsync([path], true));
    }

    private async void OnUploadAll(object sender, RoutedEventArgs eventArgs) => await UploadPendingAsync();

    private async Task UploadPendingAsync()
    {
        if (!EnsureActiveTask()) return;
        if (!await _uploadRunLock.WaitAsync(0))
        {
            _uploadRerunRequested = true;
            SetStatus("上传队列正在运行；新文件将在本轮结束后自动继续。");
            return;
        }

        try
        {
            var candidates = QueueItems.Where(item => item.CanUpload).ToArray();
            if (candidates.Length == 0)
            {
                SetStatus("当前没有等待上传的文件；冲突文件需先勾选确认。 ");
                return;
            }

            _uploadCancellation?.Dispose();
            _uploadCancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            await TrySetTaskStatusAsync("uploading");
            SetStatus($"正在上传 {candidates.Length} 个文件，并发数 2。");
            using var concurrency = new SemaphoreSlim(2, 2);
            var tasks = candidates.Select(item => UploadOneAsync(item, concurrency, _uploadCancellation.Token)).ToArray();
            await Task.WhenAll(tasks);

            var hasFailures = candidates.Any(item => item.Status == "上传失败");
            await TrySetTaskStatusAsync(hasFailures ? "connected" : "completed");
            SetStatus(hasFailures ? "队列已完成本轮处理，存在失败项，可点击“重试失败”。" : "上传完成；网页会自动刷新并选中最新资料。");
        }
        catch (OperationCanceledException)
        {
            SetStatus(_taskExpired ? "任务已过期，上传已停止。" : "上传队列已停止。");
        }
        finally
        {
            _uploadRunLock.Release();
            UpdateQueueSummary();
            if (_uploadRerunRequested && !_taskExpired)
            {
                _uploadRerunRequested = false;
                _ = Dispatcher.InvokeAsync(async () => await UploadPendingAsync());
            }
        }
    }

    private async Task UploadOneAsync(FileQueueItem item, SemaphoreSlim concurrency, CancellationToken cancellationToken)
    {
        await concurrency.WaitAsync(cancellationToken);
        try
        {
            await _pauseGate.WaitAsync(cancellationToken);
            await Dispatcher.InvokeAsync(() =>
            {
                item.Status = "正在上传";
                item.Message = "正在发送原文件";
            });
            var result = await _api.UploadAsync(item, value =>
            {
                _ = Dispatcher.InvokeAsync(() => item.Progress = Math.Clamp(value, 0, 100));
            }, cancellationToken);
            await Dispatcher.InvokeAsync(() =>
            {
                item.Progress = 100;
                item.DuplicateStatus = result.DuplicateStatus == "new_version" ? "新版本" : item.DuplicateStatus;
                item.Status = result.Skipped ? "重复跳过" : "上传成功";
                item.Message = result.Skipped
                    ? "相同内容已存在，服务器已跳过"
                    : result.DrawingLibrarySync?.Linked == true ? "已写入工单并同步图纸资料库" : "已写入工单；图纸资料库未建立关联";
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await Dispatcher.InvokeAsync(() =>
            {
                if (item.Status == "正在上传")
                {
                    item.Status = "上传失败";
                    item.Message = "上传已停止，可在有效期内重试";
                }
            });
            throw;
        }
        catch (Exception error)
        {
            await Dispatcher.InvokeAsync(() =>
            {
                item.Status = "上传失败";
                item.Message = FriendlyError(error);
            });
        }
        finally
        {
            concurrency.Release();
            await Dispatcher.InvokeAsync(UpdateQueueSummary);
        }
    }

    private async void OnToggleQueuePause(object sender, RoutedEventArgs eventArgs)
    {
        if (_pauseGate.IsPaused)
        {
            _pauseGate.Resume();
            PauseQueueButton.Content = "暂停队列";
            await TrySetTaskStatusAsync("uploading");
            SetStatus("上传队列已继续。");
        }
        else
        {
            _pauseGate.Pause();
            PauseQueueButton.Content = "继续队列";
            await TrySetTaskStatusAsync("paused");
            SetStatus("上传队列已暂停；正在传输的单个文件会先完成。");
        }
    }

    private async void OnRetryFailed(object sender, RoutedEventArgs eventArgs)
    {
        foreach (var item in QueueItems.Where(item => item.Status == "上传失败"))
        {
            item.Status = "等待上传";
            item.Message = "等待重试";
            item.Progress = 0;
        }
        await UploadPendingAsync();
    }

    private void OnClearCompleted(object sender, RoutedEventArgs eventArgs)
    {
        foreach (var item in QueueItems.Where(item => item.Status is "上传成功" or "重复跳过").ToArray()) QueueItems.Remove(item);
        UpdateQueueSummary();
    }

    private void OnOpenWeb(object sender, RoutedEventArgs eventArgs)
    {
        Process.Start(new ProcessStartInfo(new Uri(_activeBaseUrl, "/dashboard").ToString()) { UseShellExecute = true });
    }

    private async void OnPairTask(object sender, RoutedEventArgs eventArgs)
    {
        var code = PairingCodeText.Text.Trim();
        if (code.Length is < 6 or > 8 || !code.All(char.IsDigit))
        {
            SetError("请输入网页显示的 6～8 位手动任务码");
            return;
        }

        if (!await _taskConnectionLock.WaitAsync(0))
        {
            SetStatus("正在连接任务，请稍候...");
            return;
        }

        PairButton.IsEnabled = false;
        PairButton.Content = "连接中...";
        _connectionState = "正在使用任务码连接";
        SetStatus("正在验证手动任务码...");
        try
        {
            var officialOrigin = ServiceOriginPolicy.GetOfficialServiceOrigin();
            var paired = await _api.PairAsync(officialOrigin, code, _lifetime.Token);
            var baseUrl = string.IsNullOrWhiteSpace(paired.BaseUrl)
                ? officialOrigin
                : ServiceOriginPolicy.NormalizeOrigin(paired.BaseUrl);
            ApplyPairedTask(baseUrl, paired);
        }
        catch (Exception error)
        {
            SetError(FriendlyError(error));
        }
        finally
        {
            PairButton.IsEnabled = true;
            PairButton.Content = "连接";
            _taskConnectionLock.Release();
        }
    }

    private void OnRepairProtocol(object sender, RoutedEventArgs eventArgs)
    {
        var status = _protocolRegistration.RegisterOrRepair();
        ApplyProtocolStatus(status);
        if (status.State == ProtocolRegistrationState.Registered)
        {
            _lastError = "";
            SetStatus("浏览器协议已注册，无需管理员权限");
        }
        else
        {
            SetError(status.Message);
        }
    }

    private void OnTestProtocol(object sender, RoutedEventArgs eventArgs)
    {
        var status = _protocolRegistration.LaunchProtocolTest();
        ApplyProtocolStatus(status);
        if (status.State == ProtocolRegistrationState.Registered) SetStatus(status.Message);
        else SetError(status.Message);
    }

    private async void OnReconnectTask(object sender, RoutedEventArgs eventArgs)
    {
        if (_task is null || !_api.IsConfigured)
        {
            SetError("当前没有可重连任务，请使用网页协议或手动任务码连接");
            return;
        }
        if (!await _taskConnectionLock.WaitAsync(0))
        {
            SetStatus("正在连接任务，请稍候...");
            return;
        }
        try
        {
            _connectionState = "正在重新连接";
            SetStatus("正在重新连接当前任务...");
            var connected = await _api.ConnectAsync(_lifetime.Token);
            ApplyConnectedTask(_activeBaseUrl, _task.TaskId, connected);
        }
        catch (Exception error)
        {
            SetError(FriendlyError(error));
        }
        finally
        {
            _taskConnectionLock.Release();
        }
    }

    private void OnCopyDiagnostics(object sender, RoutedEventArgs eventArgs)
    {
        try
        {
            Clipboard.SetText(BuildDiagnosticReport());
            SetStatus("已复制脱敏诊断信息");
        }
        catch (Exception error)
        {
            SetError($"复制诊断信息失败：{error.Message}");
        }
    }

    private void OnCheckUpdates(object sender, RoutedEventArgs eventArgs)
    {
        Process.Start(new ProcessStartInfo(AppConstants.UpdateUrl) { UseShellExecute = true });
    }

    private void OnRemoveTask(object sender, RoutedEventArgs eventArgs)
    {
        if (_task is not null && MessageBox.Show(this, "仅从助手移除当前临时任务？本地文件和已上传资料都不会删除。", "移除任务", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        _monitor.Stop();
        _uploadCancellation?.Cancel();
        _api.Clear();
        _task = null;
        _taskExpired = false;
        _connectionState = "未连接";
        QueueItems.Clear();
        _expiryTimer.Stop();
        MonitorButton.Content = "开始监控";
        MonitorStatusText.Text = "未启动";
        UpdateTaskHeader();
        UpdateQueueSummary();
        SetStatus("任务已从助手移除，请从网页重新创建任务。");
    }

    private bool EnsureActiveTask()
    {
        if (_task is null || !_api.IsConfigured)
        {
            SetStatus("请先从工单资料库网页点击“从微盘导入”创建任务。");
            return false;
        }
        if (_taskExpired || _task.ExpiresAt <= DateTimeOffset.Now)
        {
            SetStatus("任务已过期，请回到网页重新创建任务。");
            return false;
        }
        return true;
    }

    private async Task TrySetTaskStatusAsync(string state)
    {
        if (!_api.IsConfigured || _taskExpired) return;
        try { await _api.SetStatusAsync(state, _lifetime.Token); } catch { }
    }

    private void UpdateQueueSummary()
    {
        var success = QueueItems.Count(item => item.Status == "上传成功");
        var duplicate = QueueItems.Count(item => item.Status == "重复跳过");
        var failed = QueueItems.Count(item => item.Status is "上传失败" or "校验失败");
        QueueSummaryText.Text = $"队列 {QueueItems.Count} · 成功 {success} · 重复 {duplicate} · 失败 {failed}";
    }

    private void SetStatus(string message)
    {
        StatusText.Text = message;
        UpdateDiagnostics();
    }

    private void SetError(string message)
    {
        _lastError = message;
        if (_connectionState is "正在使用任务码连接" or "正在重新连接" or "等待安全交接") _connectionState = "连接失败";
        StatusText.Text = message;
        UpdateDiagnostics();
    }

    private void ApplyProtocolStatus(ProtocolRegistrationStatus status)
    {
        ProtocolStatusText.Text = status.State switch
        {
            ProtocolRegistrationState.Registered => "已注册",
            ProtocolRegistrationState.NotRegistered => "未注册",
            ProtocolRegistrationState.NeedsRepair => "需要修复",
            _ => "注册失败",
        };
        ProtocolStatusText.ToolTip = status.Message;
        ProtocolCommandText.Text = string.IsNullOrWhiteSpace(status.Command) ? "无法确定" : status.Command;
        if (status.State == ProtocolRegistrationState.Error) _lastError = status.Message;
    }

    private void UpdateDiagnostics()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? assembly.GetName().Version?.ToString()
            ?? AppConstants.HelperVersion;
        var parts = informational.Split('+', 2);
        var commit = parts.Length > 1 ? parts[1] : "local";
        VersionText.Text = $"{parts[0]} / {ShortCommit(commit)}";
        CurrentUserText.Text = $"{Environment.UserDomainName}\\{Environment.UserName} / 当前用户单实例 / {ShortCommit(_helperInstanceId)}";
        ConnectionDiagnosticText.Text = $"{ServiceOriginPolicy.GetOfficialServiceOrigin().GetLeftPart(UriPartial.Authority)} / {_connectionState} / {(_task is null ? "无任务" : _taskExpired ? "已过期" : _task.Summary.State)}";
        LastErrorText.Text = string.IsNullOrWhiteSpace(_lastError) ? "无" : _lastError;
    }

    private string BuildDiagnosticReport()
    {
        var status = _protocolRegistration.Inspect();
        var report = new StringBuilder();
        report.AppendLine($"助手版本/构建: {VersionText.Text}");
        report.AppendLine($"当前用户: {Environment.UserDomainName}\\{Environment.UserName}");
        report.AppendLine($"协议状态: {status.State}");
        report.AppendLine($"协议命令路径: {status.Command}");
        report.AppendLine("单实例状态: 当前用户单实例已启用");
        report.AppendLine($"助手实例: {ShortCommit(_helperInstanceId)}");
        report.AppendLine($"服务地址: {ServiceOriginPolicy.GetOfficialServiceOrigin().GetLeftPart(UriPartial.Authority)}");
        report.AppendLine($"服务连接状态: {_connectionState}");
        report.AppendLine($"当前任务状态: {(_task is null ? "无任务" : _taskExpired ? "已过期" : _task.Summary.State)}");
        report.AppendLine($"最后一次错误: {(string.IsNullOrWhiteSpace(_lastError) ? "无" : _lastError)}");
        report.Append("敏感信息: ticket、Cookie、对象存储和密码均未包含");
        return report.ToString();
    }

    private static string ShortCommit(string value)
    {
        if (value.Equals("local", StringComparison.OrdinalIgnoreCase)) return value;
        return value.Length > 12 ? value[..12] : value;
    }

    private static string FriendlyError(Exception error)
    {
        if (error is ServiceOriginNotAllowedException) return "任务服务地址不在允许列表中";
        if (error is ImportApiException apiError)
        {
            if (apiError.StatusCode == 410) return "任务已过期，请从网页重新创建";
            if (apiError.StatusCode == 401) return apiError.Code.StartsWith("PAIRING_", StringComparison.Ordinal) ? apiError.Message : "任务凭据无效";
            if (apiError.StatusCode == 403) return "任务授权已失效，请从网页重新创建";
        }
        if (error is HttpRequestException httpError
            && (httpError.InnerException is System.Security.Authentication.AuthenticationException
                || httpError.Message.Contains("SSL", StringComparison.OrdinalIgnoreCase)
                || httpError.Message.Contains("TLS", StringComparison.OrdinalIgnoreCase)))
        {
            return "TLS 安全连接失败，请检查系统时间和网络证书";
        }
        if (error is HttpRequestException) return "无法连接工单资料库，请检查网络";
        return error.Message;
    }

    protected override async void OnClosed(EventArgs eventArgs)
    {
        _expiryTimer.Stop();
        _coordinator.LaunchArgumentReceived -= OnLaunchArgumentReceived;
        _handoffServer.HandoffReceived -= OnHandoffReceived;
        _monitor.FileDetected -= OnMonitorFileDetected;
        _monitor.Dispose();
        _uploadCancellation?.Cancel();
        _uploadCancellation?.Dispose();
        _lifetime.Cancel();
        _api.Dispose();
        await _handoffServer.DisposeAsync();
        _uploadRunLock.Dispose();
        _lifetime.Dispose();
        base.OnClosed(eventArgs);
    }
}
