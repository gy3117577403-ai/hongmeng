using System.Text;
using System.Windows;
using Hongmeng.WorkOrder.ImportHelper.Models;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public static class DropDataInspector
{
    public const string FileGroupDescriptorW = "FileGroupDescriptorW";
    public const string FileGroupDescriptor = "FileGroupDescriptor";
    public const string FileContents = "FileContents";
    public const string FileNameW = "FileNameW";
    public const string FileName = "FileName";
    public const string ShellIdList = "Shell IDList Array";
    private static readonly string[] UrlFormats = ["UniformResourceLocatorW", "UniformResourceLocator", "text/uri-list"];

    public static DropDataInspection Inspect(IDataObject data)
    {
        var formats = SafeFormats(data);
        var hasFileDrop = SafeHasFormat(data, DataFormats.FileDrop, true);
        var hasDescriptor = SafeHasFormat(data, FileGroupDescriptorW) || SafeHasFormat(data, FileGroupDescriptor);
        var hasContents = SafeHasFormat(data, FileContents);
        var hasLegacyName = SafeHasFormat(data, FileNameW) || SafeHasFormat(data, FileName);
        var hasShellIdList = SafeHasFormat(data, ShellIdList);
        var hasTextOrUrl = SafeHasFormat(data, DataFormats.Text)
            || SafeHasFormat(data, DataFormats.UnicodeText)
            || SafeHasFormat(data, DataFormats.StringFormat)
            || UrlFormats.Any(format => SafeHasFormat(data, format));

        var kind = hasFileDrop
            ? FileIntakeKind.LocalFile
            : hasDescriptor && hasContents
                ? FileIntakeKind.VirtualFile
                : hasLegacyName
                    ? FileIntakeKind.LocalFile
                    : hasTextOrUrl
                        ? FileIntakeKind.LinkOnly
                        : FileIntakeKind.Unsupported;

        var canAccept = kind switch
        {
            FileIntakeKind.LocalFile => TryGetLocalPaths(data).Any(FileValidator.IsSupportedFileName),
            FileIntakeKind.VirtualFile => HasSupportedVirtualFileName(data),
            _ => false,
        };

        return new DropDataInspection
        {
            Formats = formats,
            HasFileDrop = hasFileDrop,
            HasVirtualDescriptor = hasDescriptor,
            HasFileContents = hasContents,
            HasLegacyFileName = hasLegacyName,
            HasShellIdList = hasShellIdList,
            HasTextOrUrl = hasTextOrUrl,
            CanAccept = canAccept,
            Kind = kind,
        };
    }

    public static IReadOnlyList<string> TryGetLocalPaths(IDataObject data)
    {
        try
        {
            if (data.GetData(DataFormats.FileDrop, true) is string[] paths) return paths;
            foreach (var format in new[] { FileNameW, FileName })
            {
                var value = data.GetData(format, false);
                if (value is string path) return [path];
                if (value is string[] pathArray) return pathArray;
                if (value is Stream stream)
                {
                    var decoded = DecodeLegacyFileName(stream, format == FileNameW);
                    if (decoded.Length > 0) return [decoded];
                }
            }
        }
        catch
        {
            // Unsupported shell data is classified without surfacing its content.
        }
        return [];
    }

    public static string BuildSanitizedDiagnostic(DropDataInspection inspection)
    {
        var formats = inspection.Formats.Count == 0 ? "无" : string.Join(", ", inspection.Formats);
        var label = inspection.Kind switch
        {
            FileIntakeKind.LocalFile => "本地文件",
            FileIntakeKind.VirtualFile => "虚拟文件",
            FileIntakeKind.LinkOnly => "仅链接",
            _ => "不支持",
        };
        return string.Join(Environment.NewLine,
            $"格式: {formats}",
            $"FileDrop: {YesNo(inspection.HasFileDrop)}",
            $"FileGroupDescriptorW: {YesNo(inspection.HasVirtualDescriptor)}",
            $"FileContents: {YesNo(inspection.HasFileContents)}",
            $"Shell IDList Array: {YesNo(inspection.HasShellIdList)}",
            $"文本或 URL: {YesNo(inspection.HasTextOrUrl)}",
            $"当前判断: {label}");
    }

    private static IReadOnlyList<string> SafeFormats(IDataObject data)
    {
        try
        {
            return data.GetFormats(false)
                .Where(format => !string.IsNullOrWhiteSpace(format))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(format => format, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private static bool SafeHasFormat(IDataObject data, string format, bool autoConvert = false)
    {
        try { return data.GetDataPresent(format, autoConvert); }
        catch { return false; }
    }

    private static bool HasSupportedVirtualFileName(IDataObject data)
    {
        try
        {
            return ShellVirtualFileExtractor.ReadDescriptors(data).Any(item => FileValidator.IsSupportedFileName(item.FileName));
        }
        catch
        {
            return true;
        }
    }

    private static string DecodeLegacyFileName(Stream stream, bool unicode)
    {
        if (stream.CanSeek) stream.Position = 0;
        using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        while (true)
        {
            var read = stream.Read(chunk, 0, chunk.Length);
            if (read == 0) break;
            if (buffer.Length + read > 64 * 1024) throw new InvalidDataException("文件名数据过大");
            buffer.Write(chunk, 0, read);
        }
        var bytes = buffer.ToArray();
        var value = unicode ? Encoding.Unicode.GetString(bytes) : Encoding.Default.GetString(bytes);
        return value.TrimEnd('\0').Trim();
    }

    private static string YesNo(bool value) => value ? "是" : "否";
}
