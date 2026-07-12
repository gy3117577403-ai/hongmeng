using System.Net;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class ProgressStreamContent : HttpContent
{
    private readonly Stream _source;
    private readonly long _length;
    private readonly Action<long, long> _progress;

    public ProgressStreamContent(Stream source, long length, Action<long, long> progress)
    {
        _source = source;
        _length = length;
        _progress = progress;
        Headers.ContentLength = length;
    }

    protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
    {
        await SerializeSourceAsync(stream, CancellationToken.None);
    }

    protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context, CancellationToken cancellationToken)
    {
        await SerializeSourceAsync(stream, cancellationToken);
    }

    private async Task SerializeSourceAsync(Stream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[128 * 1024];
        long transferred = 0;
        int read;
        while ((read = await _source.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)) > 0)
        {
            await stream.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            transferred += read;
            _progress(transferred, _length);
        }
    }

    protected override bool TryComputeLength(out long length)
    {
        length = _length;
        return true;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _source.Dispose();
        base.Dispose(disposing);
    }
}
