namespace Hongmeng.WorkOrder.ImportHelper.Models;

public enum FileIntakeKind
{
    Unsupported,
    LocalFile,
    VirtualFile,
    LinkOnly
}

public sealed class DropDataInspection
{
    public IReadOnlyList<string> Formats { get; init; } = [];
    public bool HasFileDrop { get; init; }
    public bool HasVirtualDescriptor { get; init; }
    public bool HasFileContents { get; init; }
    public bool HasLegacyFileName { get; init; }
    public bool HasShellIdList { get; init; }
    public bool HasTextOrUrl { get; init; }
    public bool CanAccept { get; init; }
    public FileIntakeKind Kind { get; init; }
}

public sealed class IntakeFile
{
    public required string Path { get; init; }
    public bool IsTemporary { get; init; }
    public bool IsPreStabilized { get; init; }
}

public sealed class FileIntakeResult
{
    public FileIntakeKind Kind { get; init; }
    public IReadOnlyList<IntakeFile> Files { get; init; } = [];
    public string Message { get; init; } = "";
}

public sealed class VirtualFileDescriptor
{
    public required string FileName { get; init; }
    public long? Size { get; init; }
}
