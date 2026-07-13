using System.Windows;
using Hongmeng.WorkOrder.ImportHelper.Models;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class FileIntakeService(ShellVirtualFileExtractor virtualFileExtractor)
{
    public DragDropEffects DetermineDragEffect(IDataObject data) =>
        DropDataInspector.Inspect(data).CanAccept ? DragDropEffects.Copy : DragDropEffects.None;

    public async Task<FileIntakeResult> ExtractAsync(
        IDataObject data,
        string taskId,
        TaskLimits limits,
        CancellationToken cancellationToken)
    {
        var inspection = DropDataInspector.Inspect(data);
        switch (inspection.Kind)
        {
            case FileIntakeKind.LocalFile:
                return BuildLocalResult(DropDataInspector.TryGetLocalPaths(data));
            case FileIntakeKind.VirtualFile:
            {
                var files = await virtualFileExtractor.ExtractAsync(
                    data,
                    taskId,
                    limits.MaxFiles,
                    limits.MaxFileBytes,
                    limits.MaxTotalBytes,
                    cancellationToken);
                return new FileIntakeResult
                {
                    Kind = FileIntakeKind.VirtualFile,
                    Files = files,
                    Message = $"已读取 {files.Count} 个微盘虚拟文件流",
                };
            }
            case FileIntakeKind.LinkOnly:
                return new FileIntakeResult
                {
                    Kind = FileIntakeKind.LinkOnly,
                    Message = "只收到链接，不能安全导入，请点击下载后由助手监控目录。",
                };
            default:
                return new FileIntakeResult
                {
                    Kind = FileIntakeKind.Unsupported,
                    Message = "未收到支持的 PDF 或图片文件格式。",
                };
        }
    }

    public static FileIntakeResult BuildLocalResult(IEnumerable<string> paths)
    {
        var accepted = new List<IntakeFile>();
        var unsupported = 0;
        var missing = 0;
        foreach (var rawPath in paths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                var path = Path.GetFullPath(rawPath);
                if (!File.Exists(path))
                {
                    missing += 1;
                    continue;
                }
                if (!FileValidator.IsSupportedFileName(path))
                {
                    unsupported += 1;
                    continue;
                }
                accepted.Add(new IntakeFile { Path = path });
            }
            catch
            {
                missing += 1;
            }
        }

        var message = accepted.Count > 0
            ? $"已接收 {accepted.Count} 个本地文件"
            : unsupported > 0
                ? "仅支持 PDF、JPG、JPEG、PNG、WEBP；EXE、ZIP、快捷方式和脚本不会接收。"
                : missing > 0
                    ? "没有收到可读取的真实文件。"
                    : "未收到本地文件。";
        return new FileIntakeResult { Kind = FileIntakeKind.LocalFile, Files = accepted, Message = message };
    }
}
