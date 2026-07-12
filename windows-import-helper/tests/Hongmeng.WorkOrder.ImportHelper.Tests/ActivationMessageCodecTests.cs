using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class ActivationMessageCodecTests
{
    [Fact]
    public async Task RoundTripsProtocolMessageWithinLimit()
    {
        var message = $"{AppConstants.ProtocolScheme}://ping";
        await using var stream = new MemoryStream();
        await ActivationMessageCodec.WriteAsync(stream, message, CancellationToken.None);
        stream.Position = 0;

        var decoded = await ActivationMessageCodec.ReadAsync(stream, CancellationToken.None);

        Assert.Equal(message, decoded);
    }

    [Fact]
    public async Task RejectsOversizedMessage()
    {
        await using var stream = new MemoryStream();
        await Assert.ThrowsAsync<InvalidDataException>(() => ActivationMessageCodec.WriteAsync(
            stream,
            new string('x', AppConstants.MaxProtocolUriLength + 1),
            CancellationToken.None));
    }
}
