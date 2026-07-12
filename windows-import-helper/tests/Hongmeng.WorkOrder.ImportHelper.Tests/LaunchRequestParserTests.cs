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

    [Theory]
    [InlineData("https://qdowqencjyph.sealoshzh.site/")]
    [InlineData("https://QDOWQENCJYPH.SEALOSHZH.SITE:443/api/local-import/tasks/pair")]
    public void ProtocolActivationUsesNormalizedOfficialOrigin(string serviceUrl)
    {
        var url = $"hongmeng-workorder-import://launch?handshakeId={Guid.NewGuid()}&taskId={Guid.NewGuid()}&baseUrl={Uri.EscapeDataString(serviceUrl)}";

        var parsed = LaunchRequestParser.TryParse(url, out var request);

        Assert.True(parsed);
        Assert.Equal(AppConstants.OfficialServiceOrigin, request?.BaseUrl.AbsoluteUri.TrimEnd('/'));
    }

    [Fact]
    public void ProtocolActivationWithoutServiceUrlUsesOfficialOrigin()
    {
        var url = $"hongmeng-workorder-import://launch?handshakeId={Guid.NewGuid()}&taskId={Guid.NewGuid()}";

        Assert.True(LaunchRequestParser.TryParse(url, out var request));
        Assert.Equal(AppConstants.OfficialServiceOrigin, request?.BaseUrl.AbsoluteUri.TrimEnd('/'));
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
    [InlineData("https://qdowqencjyph.sealoshzh.site.evil.com")]
    [InlineData("https://user@qdowqencjyph.sealoshzh.site")]
    [InlineData("https://qdowqencjyph.sealoshzh.site:8443")]
    public void RejectsUnlistedOrigins(string origin)
    {
        var url = $"hongmeng-workorder-import://launch?handshakeId={Guid.NewGuid()}&taskId={Guid.NewGuid()}&baseUrl={Uri.EscapeDataString(origin)}";
        Assert.False(LaunchRequestParser.TryParse(url, out _));
    }
}
