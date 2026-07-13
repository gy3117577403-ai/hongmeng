namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class VirtualFileTempStore
{
    private static readonly HashSet<string> ReservedNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    public VirtualFileTempStore(string? rootPath = null)
    {
        RootPath = Path.GetFullPath(rootPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Hongmeng.WorkOrder.ImportHelper",
            "Temp"));
    }

    public string RootPath { get; }

    public string CreateUniquePath(string taskId, string rawFileName)
    {
        var taskDirectory = GetTaskDirectory(taskId);
        Directory.CreateDirectory(taskDirectory);
        var safeName = SanitizeFileName(rawFileName);
        var candidate = SafeCombine(taskDirectory, safeName);
        var extension = Path.GetExtension(safeName);
        var stem = Path.GetFileNameWithoutExtension(safeName);
        for (var suffix = 2; File.Exists(candidate); suffix++)
        {
            candidate = SafeCombine(taskDirectory, $"{stem} ({suffix}){extension}");
        }
        return candidate;
    }

    public string GetTaskDirectory(string taskId)
    {
        var segment = string.Concat(taskId.Where(character => char.IsLetterOrDigit(character) || character is '-' or '_'));
        if (segment.Length == 0) segment = "task";
        if (segment.Length > 80) segment = segment[..80];
        return SafeCombine(RootPath, segment);
    }

    public bool IsManagedPath(string path)
    {
        try
        {
            var fullPath = Path.GetFullPath(path);
            var prefix = RootPath.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return fullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public void DeleteFile(string path)
    {
        if (!IsManagedPath(path)) return;
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    public void CleanupTask(string taskId)
    {
        var directory = GetTaskDirectory(taskId);
        if (!IsManagedPath(Path.Combine(directory, "placeholder"))) return;
        try { if (Directory.Exists(directory)) Directory.Delete(directory, true); } catch { }
    }

    public void CleanupAll()
    {
        try { if (Directory.Exists(RootPath)) Directory.Delete(RootPath, true); } catch { }
    }

    public static string SanitizeFileName(string rawFileName)
    {
        var normalized = (rawFileName ?? "").Replace('\\', '/');
        var leaf = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? "";
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var cleaned = new string(leaf.Select(character => invalid.Contains(character) || char.IsControl(character) ? '_' : character).ToArray())
            .Trim()
            .TrimEnd('.', ' ');
        if (cleaned is "" or "." or "..") cleaned = "virtual-file";

        var extension = Path.GetExtension(cleaned);
        var stem = Path.GetFileNameWithoutExtension(cleaned);
        if (ReservedNames.Contains(stem)) stem = $"_{stem}";
        if (stem.Length > 180) stem = stem[..180];
        if (extension.Length > 20) extension = "";
        return stem + extension;
    }

    private static string SafeCombine(string root, string child)
    {
        var fullRoot = Path.GetFullPath(root);
        var candidate = Path.GetFullPath(Path.Combine(fullRoot, child));
        var prefix = fullRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("临时文件路径无效");
        return candidate;
    }
}
