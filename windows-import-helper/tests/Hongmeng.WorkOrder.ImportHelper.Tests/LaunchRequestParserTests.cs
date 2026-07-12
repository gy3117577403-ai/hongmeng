using Hongmeng.WorkOrder.ImportHelper.Models;
using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class LaunchRequestParserTests
{
    [Fact]
    public void AcceptsOfficialOriginWithoutTicketInProtocolUrl()
    {
        var handshakeId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        var url = $"hongmeng-workorder-import://launch?handshakeId={handshakeId}&taskId={taskId}&baseUrl={Uri.EscapeDataString(AppConstants.AllowedWebOrigin)}";

        var parsed = LaunchRequestParser.TryParse(url, out var request);

        Assert.True(parsed);
        Assert.NotNull(request);
        Assert.Equal(taskId.ToString(), request.TaskId);
        Assert.DoesNotContain("ticket", url, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AcceptsPingWithoutCreatingTask()
    {
        Assert.True(LaunchRequestParser.TryParseActivation(
            $"{AppConstants.ProtocolScheme}://ping",
            out var activation));
        Assert.Equal(ProtocolActivationKind.Ping, activation?.Kind);
        Assert.Null(activation?.LaunchRequest);
    }

    [Fact]
    public void RejectsTicketInProtocolUrl()
    {
        var url = $"{AppConstants.ProtocolScheme}://launch?handshakeId={Guid.NewGuid()}&taskId={Guid.NewGuid()}&baseUrl={Uri.EscapeDataString(AppConstants.AllowedWebOrigin)}&ticket=secret";
        Assert.False(LaunchRequestParser.TryParse(url, out _));
    }

    [Theory]
    [InlineData("http://127.0.0.1:3000")]
    [InlineData("https://example.com")]
    public void RejectsUnlistedOrigins(string origin)
    {
        var url = $"hongmeng-workorder-import://launch?handshakeId={Guid.NewGuid()}&taskId={Guid.NewGuid()}&baseUrl={Uri.EscapeDataString(origin)}";
        Assert.False(LaunchRequestParser.TryParse(url, out _));
    }
}
