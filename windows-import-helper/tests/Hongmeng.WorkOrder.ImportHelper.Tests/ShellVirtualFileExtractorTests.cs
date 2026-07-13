using System.Buffers.Binary;
using System.Text;
using System.Windows;
using Hongmeng.WorkOrder.ImportHelper.Models;
using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class ShellVirtualFileExtractorTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"hongmeng-virtual-tests-{Guid.NewGuid():N}");
    private readonly VirtualFileTempStore _store;
    private readonly ShellVirtualFileExtractor _extractor;

    public ShellVirtualFileExtractorTests()
    {
        Directory.CreateDirectory(_directory);
        _store = new VirtualFileTempStore(Path.Combine(_directory, "store"));
        _extractor = new ShellVirtualFileExtractor(_store);
    }

    [Fact]
    public void ParsesUnicodeVirtualFileDescriptors()
    {
        var buffer = BuildDescriptorBuffer(("中文图纸.pdf", 123), ("产品照片.jpg", 456));

        var descriptors = ShellVirtualFileExtractor.ParseDescriptorBuffer(buffer, true);

        Assert.Equal(2, descriptors.Count);
        Assert.Equal("中文图纸.pdf", descriptors[0].FileName);
        Assert.Equal(456, descriptors[1].Size);
    }

    [Fact]
    public async Task MaterializesVirtualFileStreamIntoTaskTempDirectory()
    {
        var bytes = Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF\n");
        var data = BuildDataObject([("virtual.pdf", bytes)]);

        var files = await _extractor.ExtractAsync(data, "task-one", 20, 1024, 4096, CancellationToken.None);

        var file = Assert.Single(files);
        Assert.True(file.IsTemporary);
        Assert.True(_store.IsManagedPath(file.Path));
        Assert.Equal(bytes, await File.ReadAllBytesAsync(file.Path));
    }

    [Fact]
    public async Task ExtractsMultipleVirtualFilesByIndex()
    {
        var data = BuildDataObject([
            ("one.pdf", Encoding.ASCII.GetBytes("%PDF-one")),
            ("two.png", new byte[] { 0x89, 0x50, 0x4e, 0x47 }),
        ]);

        var files = await _extractor.ExtractAsync(data, "task-many", 20, 1024, 4096, CancellationToken.None);

        Assert.Equal(2, files.Count);
        Assert.Equal("one.pdf", Path.GetFileName(files[0].Path));
        Assert.Equal("two.png", Path.GetFileName(files[1].Path));
    }

    [Fact]
    public async Task SanitizesTraversalAndReservedDeviceNames()
    {
        var data = BuildDataObject([("../../CON.pdf", Encoding.ASCII.GetBytes("%PDF-safe"))]);

        var file = Assert.Single(await _extractor.ExtractAsync(data, "../task", 20, 1024, 4096, CancellationToken.None));

        Assert.Equal("_CON.pdf", Path.GetFileName(file.Path));
        Assert.True(_store.IsManagedPath(file.Path));
    }

    [Fact]
    public async Task AbortsOversizeUnknownLengthStreamAndCleansPartialFile()
    {
        var descriptors = new[] { new VirtualFileDescriptor { FileName = "large.pdf" } };

        await Assert.ThrowsAsync<InvalidDataException>(() => _extractor.ExtractAsync(
            descriptors,
            (_, _) => ValueTask.FromResult<Stream>(new MemoryStream(new byte[64])),
            "task-large",
            20,
            16,
            4096,
            CancellationToken.None));

        Assert.False(Directory.Exists(_store.GetTaskDirectory("task-large")));
    }

    [Fact]
    public async Task CleanupTaskRemovesMaterializedVirtualFiles()
    {
        var data = BuildDataObject([("cleanup.pdf", Encoding.ASCII.GetBytes("%PDF-cleanup"))]);
        var file = Assert.Single(await _extractor.ExtractAsync(data, "task-clean", 20, 1024, 4096, CancellationToken.None));

        _store.CleanupTask("task-clean");

        Assert.False(File.Exists(file.Path));
    }

    private static DataObject BuildDataObject((string Name, byte[] Content)[] items)
    {
        var data = new DataObject();
        data.SetData(DropDataInspector.FileGroupDescriptorW, new MemoryStream(BuildDescriptorBuffer(items.Select(item => (item.Name, (long)item.Content.Length)).ToArray())));
        data.SetData(DropDataInspector.FileContents, items.Select(item => (Stream)new MemoryStream(item.Content, false)).ToArray());
        return data;
    }

    private static byte[] BuildDescriptorBuffer(params (string Name, long Size)[] items)
    {
        const int descriptorBytes = 592;
        const int nameOffset = 72;
        var buffer = new byte[4 + descriptorBytes * items.Length];
        BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(0, 4), (uint)items.Length);
        for (var index = 0; index < items.Length; index++)
        {
            var offset = 4 + descriptorBytes * index;
            BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(offset, 4), 0x40);
            BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(offset + 64, 4), (uint)((ulong)items[index].Size >> 32));
            BinaryPrimitives.WriteUInt32LittleEndian(buffer.AsSpan(offset + 68, 4), (uint)items[index].Size);
            var encoded = Encoding.Unicode.GetBytes(items[index].Name);
            encoded.AsSpan(0, Math.Min(encoded.Length, 518)).CopyTo(buffer.AsSpan(offset + nameOffset, 520));
        }
        return buffer;
    }

    public void Dispose()
    {
        _store.CleanupAll();
        try { Directory.Delete(_directory, true); } catch { }
    }
}
