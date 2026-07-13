using System.Collections.Concurrent;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class DownloadFolderMonitor : IDisposable
{
    private readonly object _gate = new();
    private readonly HashSet<string> _seen = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, byte> _pending = new(StringComparer.OrdinalIgnoreCase);
    private readonly TimeSpan _stableDuration;
    private readonly TimeSpan _pollInterval;
    private FileSystemWatcher? _watcher;
    private CancellationTokenSource? _runCancellation;
    private DateTimeOffset _startedAt;

    public DownloadFolderMonitor(TimeSpan? stableDuration = null, TimeSpan? pollInterval = null)
    {
        _stableDuration = stableDuration ?? TimeSpan.FromSeconds(3);
        _pollInterval = pollInterval ?? TimeSpan.FromMilliseconds(500);
    }

    public bool IsPaused { get; private set; }
    public bool IsRunning => _watcher is not null;
    public event Action<string>? FileDetected;

    public void Start(string folder, DateTimeOffset? taskCreatedAt = null)
    {
        Stop();
        if (!Directory.Exists(folder)) throw new DirectoryNotFoundException("下载目录不存在");
        _startedAt = taskCreatedAt ?? DateTimeOffset.UtcNow;
        _runCancellation = new CancellationTokenSource();
        _watcher = new FileSystemWatcher(folder)
        {
            IncludeSubdirectories = false,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.LastWrite,
            EnableRaisingEvents = true,
        };
        _watcher.Created += OnChanged;
        _watcher.Changed += OnChanged;
        _watcher.Renamed += OnRenamed;
        IsPaused = false;
        try
        {
            foreach (var path in Directory.EnumerateFiles(folder)) Consider(path);
        }
        catch
        {
            Stop();
            throw;
        }
    }

    public void Pause() => IsPaused = true;
    public void Resume() => IsPaused = false;

    public void Stop()
    {
        _runCancellation?.Cancel();
        _runCancellation?.Dispose();
        _runCancellation = null;
        if (_watcher is not null)
        {
            _watcher.EnableRaisingEvents = false;
            _watcher.Created -= OnChanged;
            _watcher.Changed -= OnChanged;
            _watcher.Renamed -= OnRenamed;
            _watcher.Dispose();
            _watcher = null;
        }
        lock (_gate) _seen.Clear();
        _pending.Clear();
        IsPaused = false;
    }

    private void OnChanged(object sender, FileSystemEventArgs eventArgs) => Consider(eventArgs.FullPath);
    private void OnRenamed(object sender, RenamedEventArgs eventArgs) => Consider(eventArgs.FullPath);

    private void Consider(string path)
    {
        if (_runCancellation is null || FileValidator.IsTemporaryFile(path) || !FileValidator.IsSupportedFileName(path)) return;
        string fullPath;
        try { fullPath = Path.GetFullPath(path); } catch { return; }
        lock (_gate) if (_seen.Contains(fullPath)) return;
        if (!_pending.TryAdd(fullPath, 0)) return;
        var cancellationToken = _runCancellation.Token;
        _ = Task.Run(() => WaitForStableFileAsync(fullPath, cancellationToken), CancellationToken.None);
    }

    private async Task WaitForStableFileAsync(string path, CancellationToken cancellationToken)
    {
        long previousSize = -1;
        DateTime previousWriteTime = DateTime.MinValue;
        var stableSince = DateTimeOffset.UtcNow;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if (IsPaused)
                {
                    await Task.Delay(_pollInterval, cancellationToken);
                    stableSince = DateTimeOffset.UtcNow;
                    continue;
                }

                var info = new FileInfo(path);
                if (!info.Exists || info.Length <= 0 || info.LastWriteTimeUtc < _startedAt.UtcDateTime.AddSeconds(-2)) return;
                if (info.Length != previousSize || info.LastWriteTimeUtc != previousWriteTime)
                {
                    previousSize = info.Length;
                    previousWriteTime = info.LastWriteTimeUtc;
                    stableSince = DateTimeOffset.UtcNow;
                }
                else if (DateTimeOffset.UtcNow - stableSince >= _stableDuration && CanReadWithoutWriter(path, info.Length))
                {
                    lock (_gate)
                    {
                        if (!_seen.Add(info.FullName)) return;
                    }
                    cancellationToken.ThrowIfCancellationRequested();
                    FileDetected?.Invoke(info.FullName);
                    return;
                }
                await Task.Delay(_pollInterval, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
        finally
        {
            _pending.TryRemove(path, out _);
        }
    }

    private static bool CanReadWithoutWriter(string path, long expectedSize)
    {
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            return stream.Length == expectedSize;
        }
        catch
        {
            return false;
        }
    }

    public void Dispose() => Stop();
}
