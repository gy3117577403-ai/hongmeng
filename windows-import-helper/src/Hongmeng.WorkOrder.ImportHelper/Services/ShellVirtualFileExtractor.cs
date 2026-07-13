using System.Buffers.Binary;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using Hongmeng.WorkOrder.ImportHelper.Models;
using ComTypes = System.Runtime.InteropServices.ComTypes;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class ShellVirtualFileExtractor(VirtualFileTempStore tempStore)
{
    private const int DescriptorHeaderBytes = 4;
    private const int DescriptorNameOffset = 72;
    private const int DescriptorWBytes = 592;
    private const int DescriptorABytes = 332;
    private const uint FileSizeFlag = 0x00000040;

    public static IReadOnlyList<VirtualFileDescriptor> ReadDescriptors(IDataObject data)
    {
        var unicode = data.GetDataPresent(DropDataInspector.FileGroupDescriptorW, false);
        var format = unicode ? DropDataInspector.FileGroupDescriptorW : DropDataInspector.FileGroupDescriptor;
        if (!data.GetDataPresent(format, false)) throw new InvalidDataException("未收到虚拟文件描述信息");
        var value = data.GetData(format, false);
        var bytes = ReadDescriptorBytes(value);
        return ParseDescriptorBuffer(bytes, unicode);
    }

    public static IReadOnlyList<VirtualFileDescriptor> ParseDescriptorBuffer(byte[] buffer, bool unicode)
    {
        if (buffer.Length < DescriptorHeaderBytes) throw new InvalidDataException("虚拟文件描述信息不完整");
        var count = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(0, 4)));
        if (count is <= 0 or > 500) throw new InvalidDataException("虚拟文件数量无效");
        var descriptorBytes = unicode ? DescriptorWBytes : DescriptorABytes;
        if (buffer.Length < DescriptorHeaderBytes + count * descriptorBytes) throw new InvalidDataException("虚拟文件描述信息长度无效");

        var descriptors = new List<VirtualFileDescriptor>(count);
        for (var index = 0; index < count; index++)
        {
            var offset = DescriptorHeaderBytes + index * descriptorBytes;
            var flags = BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(offset, 4));
            var fileNameBytes = buffer.AsSpan(offset + DescriptorNameOffset, unicode ? 520 : 260);
            var fileName = unicode ? DecodeUnicodeName(fileNameBytes) : DecodeAnsiName(fileNameBytes);
            if (string.IsNullOrWhiteSpace(fileName)) fileName = $"virtual-file-{index + 1}";
            long? size = null;
            if ((flags & FileSizeFlag) != 0)
            {
                var high = BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(offset + 64, 4));
                var low = BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(offset + 68, 4));
                size = checked((long)(((ulong)high << 32) | low));
            }
            descriptors.Add(new VirtualFileDescriptor { FileName = fileName, Size = size });
        }
        return descriptors;
    }

    public Task<IReadOnlyList<IntakeFile>> ExtractAsync(
        IDataObject data,
        string taskId,
        int maxFiles,
        long maxFileBytes,
        long maxTotalBytes,
        CancellationToken cancellationToken)
    {
        var descriptors = ReadDescriptors(data);
        return ExtractAsync(
            descriptors,
            (index, _) => ValueTask.FromResult(OpenContentStream(data, index)),
            taskId,
            maxFiles,
            maxFileBytes,
            maxTotalBytes,
            cancellationToken);
    }

    public async Task<IReadOnlyList<IntakeFile>> ExtractAsync(
        IReadOnlyList<VirtualFileDescriptor> descriptors,
        Func<int, CancellationToken, ValueTask<Stream>> openContent,
        string taskId,
        int maxFiles,
        long maxFileBytes,
        long maxTotalBytes,
        CancellationToken cancellationToken)
    {
        var supported = descriptors
            .Select((descriptor, index) => (descriptor, index))
            .Where(item => FileValidator.IsSupportedFileName(item.descriptor.FileName))
            .ToArray();
        if (supported.Length == 0) throw new InvalidDataException("虚拟文件中没有支持的 PDF 或图片");
        if (supported.Length > maxFiles) throw new InvalidDataException($"当前任务最多接收 {maxFiles} 个文件");
        if (supported.Any(item => item.descriptor.Size > maxFileBytes)) throw new InvalidDataException("虚拟文件超过任务单文件大小限制");
        if (supported.Where(item => item.descriptor.Size.HasValue).Sum(item => item.descriptor.Size!.Value) > maxTotalBytes)
        {
            throw new InvalidDataException("虚拟文件总大小超过任务限制");
        }

        var created = new List<IntakeFile>();
        long totalBytes = 0;
        try
        {
            foreach (var (descriptor, index) in supported)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var safeName = VirtualFileTempStore.SanitizeFileName(descriptor.FileName);
                var path = tempStore.CreateUniquePath(taskId, safeName);
                await using var source = await openContent(index, cancellationToken);
                await using var destination = new FileStream(
                    path,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    128 * 1024,
                    FileOptions.Asynchronous | FileOptions.SequentialScan);
                var bytes = await CopyWithLimitAsync(source, destination, maxFileBytes, cancellationToken);
                totalBytes = checked(totalBytes + bytes);
                if (totalBytes > maxTotalBytes) throw new InvalidDataException("虚拟文件总大小超过任务限制");
                created.Add(new IntakeFile { Path = path, IsTemporary = true, IsPreStabilized = true });
            }
            return created;
        }
        catch
        {
            foreach (var file in created) tempStore.DeleteFile(file.Path);
            tempStore.CleanupTask(taskId);
            throw;
        }
    }

    private static async Task<long> CopyWithLimitAsync(Stream source, Stream destination, long maxBytes, CancellationToken cancellationToken)
    {
        var buffer = new byte[128 * 1024];
        long total = 0;
        while (true)
        {
            var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
            if (read == 0) break;
            total = checked(total + read);
            if (total > maxBytes) throw new InvalidDataException("虚拟文件超过任务单文件大小限制");
            await destination.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
        await destination.FlushAsync(cancellationToken);
        if (total == 0) throw new InvalidDataException("虚拟文件大小为 0");
        return total;
    }

    private static byte[] ReadDescriptorBytes(object? value)
    {
        if (value is byte[] bytes) return bytes;
        if (value is not Stream stream) throw new InvalidDataException("无法读取虚拟文件描述信息");
        var originalPosition = stream.CanSeek ? stream.Position : 0;
        if (stream.CanSeek) stream.Position = 0;
        using var output = new MemoryStream();
        stream.CopyTo(output);
        if (stream.CanSeek) stream.Position = originalPosition;
        if (output.Length > 1024 * 1024) throw new InvalidDataException("虚拟文件描述信息过大");
        return output.ToArray();
    }

    private static string DecodeUnicodeName(ReadOnlySpan<byte> bytes)
    {
        var length = 0;
        while (length + 1 < bytes.Length && (bytes[length] != 0 || bytes[length + 1] != 0)) length += 2;
        return Encoding.Unicode.GetString(bytes[..length]).Trim();
    }

    private static string DecodeAnsiName(ReadOnlySpan<byte> bytes)
    {
        var length = bytes.IndexOf((byte)0);
        if (length < 0) length = bytes.Length;
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var encoding = Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage);
        return encoding.GetString(bytes[..length]).Trim();
    }

    private static Stream OpenContentStream(IDataObject data, int index)
    {
        object? value = null;
        try { value = data.GetData(DropDataInspector.FileContents, false); } catch { }
        if (value is Stream[] streams && index < streams.Length) return streams[index];
        if (value is IReadOnlyList<Stream> streamList && index < streamList.Count) return streamList[index];
        if (value is Stream stream && index == 0) return stream;
        if (value is byte[] bytes && index == 0) return new MemoryStream(bytes, false);

        var comData = FindComDataObject(data);
        if (comData is null) throw new InvalidDataException("无法读取该虚拟文件流，请使用下载目录监控");
        return OpenComContentStream(comData, index);
    }

    private static ComTypes.IDataObject? FindComDataObject(object source)
    {
        var queue = new Queue<(object Value, int Depth)>();
        var visited = new HashSet<object>(ReferenceEqualityComparer.Instance);
        queue.Enqueue((source, 0));
        while (queue.Count > 0)
        {
            var (value, depth) = queue.Dequeue();
            if (!visited.Add(value)) continue;
            if (value is ComTypes.IDataObject comData) return comData;
            if (depth >= 2) continue;
            foreach (var field in value.GetType().GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public))
            {
                if (!field.Name.Contains("data", StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    var nested = field.GetValue(value);
                    if (nested is not null) queue.Enqueue((nested, depth + 1));
                }
                catch { }
            }
        }
        return null;
    }

    private static Stream OpenComContentStream(ComTypes.IDataObject data, int index)
    {
        var format = new ComTypes.FORMATETC
        {
            cfFormat = checked((short)DataFormats.GetDataFormat(DropDataInspector.FileContents).Id),
            dwAspect = ComTypes.DVASPECT.DVASPECT_CONTENT,
            lindex = index,
            ptd = IntPtr.Zero,
            tymed = ComTypes.TYMED.TYMED_ISTREAM | ComTypes.TYMED.TYMED_HGLOBAL,
        };
        data.GetData(ref format, out var medium);
        var lease = new StgMediumLease(medium);
        try
        {
            return medium.tymed switch
            {
                ComTypes.TYMED.TYMED_ISTREAM => new ComReadStream((ComTypes.IStream)Marshal.GetObjectForIUnknown(medium.unionmember), lease),
                ComTypes.TYMED.TYMED_HGLOBAL => new HGlobalReadStream(medium.unionmember, lease),
                _ => throw new InvalidDataException("虚拟文件流格式不受支持"),
            };
        }
        catch
        {
            lease.Dispose();
            throw;
        }
    }

    [DllImport("ole32.dll")]
    private static extern void ReleaseStgMedium(ref ComTypes.STGMEDIUM medium);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr memory);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr memory);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern UIntPtr GlobalSize(IntPtr memory);

    private sealed class StgMediumLease(ComTypes.STGMEDIUM medium) : IDisposable
    {
        private ComTypes.STGMEDIUM _medium = medium;
        private bool _disposed;

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            ReleaseStgMedium(ref _medium);
        }
    }

    private sealed class ComReadStream(ComTypes.IStream stream, StgMediumLease lease) : Stream
    {
        private readonly IntPtr _bytesRead = Marshal.AllocCoTaskMem(sizeof(int));
        private bool _disposed;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            var target = offset == 0 ? buffer : new byte[count];
            stream.Read(target, count, _bytesRead);
            var read = Marshal.ReadInt32(_bytesRead);
            if (offset != 0 && read > 0) Buffer.BlockCopy(target, 0, buffer, offset, read);
            return read;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if (disposing && !_disposed)
            {
                _disposed = true;
                Marshal.FreeCoTaskMem(_bytesRead);
                if (Marshal.IsComObject(stream)) Marshal.ReleaseComObject(stream);
                lease.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    private sealed class HGlobalReadStream : Stream
    {
        private readonly IntPtr _memory;
        private readonly IntPtr _pointer;
        private readonly long _length;
        private readonly StgMediumLease _lease;
        private long _position;
        private bool _disposed;

        public HGlobalReadStream(IntPtr memory, StgMediumLease lease)
        {
            _memory = memory;
            _lease = lease;
            _pointer = GlobalLock(memory);
            if (_pointer == IntPtr.Zero) throw new InvalidDataException("无法锁定虚拟文件内存");
            _length = checked((long)GlobalSize(memory).ToUInt64());
        }

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => _length;
        public override long Position { get => _position; set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            var available = (int)Math.Min(count, _length - _position);
            if (available <= 0) return 0;
            Marshal.Copy(IntPtr.Add(_pointer, checked((int)_position)), buffer, offset, available);
            _position += available;
            return available;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if (disposing && !_disposed)
            {
                _disposed = true;
                GlobalUnlock(_memory);
                _lease.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
