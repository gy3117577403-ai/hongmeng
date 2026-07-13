using System.Security.Cryptography;
using System.Windows.Media.Imaging;
using Hongmeng.WorkOrder.ImportHelper.Models;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class FileValidator
{
    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".jpg", ".jpeg", ".png", ".webp"
    };

    public static bool IsTemporaryFile(string path)
    {
        var name = Path.GetFileName(path);
        var extension = Path.GetExtension(path);
        return string.IsNullOrWhiteSpace(name)
            || name.StartsWith('~')
            || extension.Equals(".tmp", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".part", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".crdownload", StringComparison.OrdinalIgnoreCase)
            || extension.Equals(".download", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsSupportedFileName(string path) => SupportedExtensions.Contains(Path.GetExtension(path));

    public async Task<FileValidationResult> ValidateAsync(string path, long maxFileBytes, CancellationToken cancellationToken)
        => await ValidateAsync(path, maxFileBytes, true, cancellationToken);

    public async Task<FileValidationResult> ValidateAsync(
        string path,
        long maxFileBytes,
        bool waitForStability,
        CancellationToken cancellationToken)
    {
        try
        {
            var fullPath = Path.GetFullPath(path);
            if (!File.Exists(fullPath)) return Invalid("文件不存在");
            if (IsTemporaryFile(fullPath)) return Invalid("临时下载文件暂不接收");
            if (!IsSupportedFileName(fullPath)) return Invalid("仅支持 PDF、JPG、JPEG、PNG、WEBP");

            var info = new FileInfo(fullPath);
            if ((info.Attributes & FileAttributes.Hidden) != 0) return Invalid("隐藏文件暂不接收");
            if (info.Length <= 0) return Invalid("文件大小为 0");
            if (info.Length > maxFileBytes) return Invalid("文件超过任务单文件大小限制");

            if (waitForStability)
            {
                var stable = await WaitUntilStableAsync(fullPath, cancellationToken);
                if (!stable) return Invalid("文件仍在下载或被其他程序占用");
            }

            info.Refresh();
            var extension = info.Extension.ToLowerInvariant();
            await using var stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var header = new byte[12];
            var headerLength = await stream.ReadAsync(header.AsMemory(0, header.Length), cancellationToken);
            var mimeType = DetectMime(extension, header, headerLength);
            if (mimeType.Length == 0) return Invalid("文件头与扩展名不匹配或文件已损坏");

            if (mimeType.StartsWith("image/", StringComparison.Ordinal) && mimeType != "image/webp")
            {
                stream.Position = 0;
                try
                {
                    var decoder = BitmapDecoder.Create(stream, BitmapCreateOptions.PreservePixelFormat, BitmapCacheOption.OnLoad);
                    if (decoder.Frames.Count == 0 || decoder.Frames[0].PixelWidth <= 0 || decoder.Frames[0].PixelHeight <= 0)
                    {
                        return Invalid("图片无法安全解码");
                    }
                }
                catch
                {
                    return Invalid("图片无法安全解码");
                }
            }

            stream.Position = 0;
            var hash = await SHA256.HashDataAsync(stream, cancellationToken);
            return new FileValidationResult
            {
                IsValid = true,
                MimeType = mimeType,
                Sha256 = Convert.ToHexString(hash).ToLowerInvariant(),
                Size = info.Length
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error)
        {
            return Invalid($"文件校验失败：{error.Message}");
        }
    }

    public static async Task<bool> WaitUntilStableAsync(string path, CancellationToken cancellationToken)
    {
        long previousSize = -1;
        var stableSamples = 0;
        for (var attempt = 0; attempt < 60; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var info = new FileInfo(path);
                if (!info.Exists || info.Length <= 0)
                {
                    stableSamples = 0;
                }
                else if (info.Length == previousSize)
                {
                    stableSamples += 1;
                    if (stableSamples >= 3)
                    {
                        await using var probe = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                        return probe.Length == info.Length;
                    }
                }
                else
                {
                    previousSize = info.Length;
                    stableSamples = 0;
                }
            }
            catch (IOException)
            {
                stableSamples = 0;
            }
            catch (UnauthorizedAccessException)
            {
                stableSamples = 0;
            }

            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
        }
        return false;
    }

    private static string DetectMime(string extension, byte[] header, int length)
    {
        if (extension == ".pdf" && length >= 5 && header.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) return "application/pdf";
        if ((extension == ".jpg" || extension == ".jpeg") && length >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff) return "image/jpeg";
        ReadOnlySpan<byte> png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        if (extension == ".png" && length >= 8 && header.AsSpan(0, 8).SequenceEqual(png)) return "image/png";
        if (extension == ".webp" && length >= 12 && header.AsSpan(0, 4).SequenceEqual("RIFF"u8) && header.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        return "";
    }

    private static FileValidationResult Invalid(string error) => new() { IsValid = false, Error = error };
}
