namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class HelperInstanceIdentity
{
    private readonly string _identityPath;

    public HelperInstanceIdentity(string? identityPath = null)
    {
        _identityPath = identityPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Hongmeng.WorkOrder.ImportHelper",
            "helper-instance-id.txt");
    }

    public string GetOrCreate()
    {
        try
        {
            if (File.Exists(_identityPath))
            {
                var existing = File.ReadAllText(_identityPath).Trim();
                if (IsValid(existing)) return existing;
            }

            var created = Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(Path.GetDirectoryName(_identityPath)!);
            File.WriteAllText(_identityPath, created);
            return created;
        }
        catch (Exception error)
        {
            throw new InvalidOperationException("无法初始化当前用户的助手实例标识", error);
        }
    }

    private static bool IsValid(string value) =>
        value.Length is >= 16 and <= 128 && value.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-');
}
