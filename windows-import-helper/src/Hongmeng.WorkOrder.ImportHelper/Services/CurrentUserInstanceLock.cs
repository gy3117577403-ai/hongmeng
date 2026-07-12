namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class CurrentUserInstanceLock : IDisposable
{
    private readonly string _lockPath;
    private FileStream? _stream;

    public CurrentUserInstanceLock(string? directory = null)
    {
        var root = directory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Hongmeng.WorkOrder.ImportHelper");
        _lockPath = Path.Combine(root, "instance.lock");
    }

    public bool TryAcquire()
    {
        if (_stream is not null) return true;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_lockPath)!);
            _stream = new FileStream(
                _lockPath,
                FileMode.OpenOrCreate,
                FileAccess.ReadWrite,
                FileShare.None,
                1,
                FileOptions.DeleteOnClose);
            return true;
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }

    public void Dispose()
    {
        _stream?.Dispose();
        _stream = null;
    }
}
