namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class DownloadFolderMonitor : IDisposable
{
    private readonly object _gate = new();
    private readonly HashSet<string> _seen = new(StringComparer.OrdinalIgnoreCase);
    private FileSystemWatcher? _watcher;
    private DateTimeOffset _startedAt;

    public bool IsPaused { get; private set; }
    public bool IsRunning => _watcher is not null;
    public event Action<string>? FileDetected;

    public void Start(string folder)
    {
        Stop();
        if (!Directory.Exists(folder)) throw new DirectoryNotFoundException("下载目录不存在");
        _startedAt = DateTimeOffset.UtcNow;
        _watcher = new FileSystemWatcher(folder)
        {
            IncludeSubdirectories = false,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.LastWrite,
            EnableRaisingEvents = true
        };
        _watcher.Created += OnChanged;
        _watcher.Changed += OnChanged;
        _watcher.Renamed += OnRenamed;
        IsPaused = false;
    }

    public void Pause() => IsPaused = true;
    public void Resume() => IsPaused = false;

    public void Stop()
    {
        if (_watcher is null) return;
        _watcher.EnableRaisingEvents = false;
        _watcher.Created -= OnChanged;
        _watcher.Changed -= OnChanged;
        _watcher.Renamed -= OnRenamed;
        _watcher.Dispose();
        _watcher = null;
        lock (_gate) _seen.Clear();
        IsPaused = false;
    }

    private void OnChanged(object sender, FileSystemEventArgs eventArgs) => Consider(eventArgs.FullPath);
    private void OnRenamed(object sender, RenamedEventArgs eventArgs) => Consider(eventArgs.FullPath);

    private void Consider(string path)
    {
        if (IsPaused || FileValidator.IsTemporaryFile(path)) return;
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length <= 0 || info.LastWriteTimeUtc < _startedAt.UtcDateTime.AddSeconds(-2)) return;
            lock (_gate)
            {
                if (!_seen.Add(info.FullName)) return;
            }
            FileDetected?.Invoke(info.FullName);
        }
        catch
        {
            // A subsequent watcher event can retry a file that is not ready yet.
        }
    }

    public void Dispose() => Stop();
}
