using System.Text;
using System.Windows;
using Hongmeng.WorkOrder.ImportHelper.Models;
using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class FileIntakeServiceTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"hongmeng-intake-tests-{Guid.NewGuid():N}");
    private readonly VirtualFileTempStore _tempStore;
    private readonly FileIntakeService _service;

    public FileIntakeServiceTests()
    {
        Directory.CreateDirectory(_directory);
        _tempStore = new VirtualFileTempStore(Path.Combine(_directory, "virtual"));
        _service = new FileIntakeService(new ShellVirtualFileExtractor(_tempStore));
    }

    [Fact]
    public async Task FileDropReturnsCopyAndEntersIntakePipeline()
    {
        var path = Path.Combine(_directory, "生产图纸.pdf");
        await File.WriteAllBytesAsync(path, Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF\n"));
        var data = new DataObject(DataFormats.FileDrop, new[] { path });

        var effect = _service.DetermineDragEffect(data);
        var result = await _service.ExtractAsync(data, "task-1", Limits(), CancellationToken.None);

        Assert.Equal(DragDropEffects.Copy, effect);
        Assert.Single(result.Files);
        Assert.Equal(Path.GetFullPath(path), result.Files[0].Path);
        Assert.False(result.Files[0].IsTemporary);
    }

    [Fact]
    public async Task UnsupportedExtensionIsRejected()
    {
        var path = Path.Combine(_directory, "archive.zip");
        await File.WriteAllTextAsync(path, "not accepted");
        var data = new DataObject(DataFormats.FileDrop, new[] { path });

        Assert.Equal(DragDropEffects.None, _service.DetermineDragEffect(data));
        var result = await _service.ExtractAsync(data, "task-1", Limits(), CancellationToken.None);
        Assert.Empty(result.Files);
        Assert.Contains("仅支持", result.Message);
    }

    [Fact]
    public async Task ClipboardFileDropUsesSamePipeline()
    {
        var first = Path.Combine(_directory, "first.pdf");
        var second = Path.Combine(_directory, "second.png");
        await File.WriteAllTextAsync(first, "pdf");
        await File.WriteAllTextAsync(second, "png");
        var clipboardData = new DataObject(DataFormats.FileDrop, new[] { first, second });

        var result = await _service.ExtractAsync(clipboardData, "task-1", Limits(), CancellationToken.None);

        Assert.Equal(2, result.Files.Count);
    }

    [Fact]
    public async Task LinkOnlyClipboardIsRejectedWithoutFetching()
    {
        var data = new DataObject();
        data.SetData(DataFormats.UnicodeText, "https://private.example.invalid/file.pdf");

        Assert.Equal(DragDropEffects.None, _service.DetermineDragEffect(data));
        var result = await _service.ExtractAsync(data, "task-1", Limits(), CancellationToken.None);
        Assert.Equal(FileIntakeKind.LinkOnly, result.Kind);
        Assert.Empty(result.Files);
        Assert.Contains("链接", result.Message);
    }

    private static TaskLimits Limits() => new() { MaxFiles = 20, MaxFileBytes = 1024 * 1024, MaxTotalBytes = 10 * 1024 * 1024 };

    public void Dispose()
    {
        _tempStore.CleanupAll();
        try { Directory.Delete(_directory, true); } catch { }
    }
}
