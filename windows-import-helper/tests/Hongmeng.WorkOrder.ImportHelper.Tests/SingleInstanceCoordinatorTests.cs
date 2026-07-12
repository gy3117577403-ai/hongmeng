using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class SingleInstanceCoordinatorTests
{
    [Fact]
    public async Task ForwardsValidatedPingToCurrentUserPipe()
    {
        var pipeName = $"Hongmeng.WorkOrder.ImportHelper.Tests.{Guid.NewGuid():N}";
        using var coordinator = new SingleInstanceCoordinator(pipeName);
        var received = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        coordinator.LaunchArgumentReceived += value => received.TrySetResult(value);
        coordinator.Start();

        var ping = $"{AppConstants.ProtocolScheme}://ping";
        var forwarded = await SingleInstanceCoordinator.ForwardLaunchArgumentAsync(ping, pipeName);
        var result = await received.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(forwarded);
        Assert.Equal(ping, result);
    }

    [Fact]
    public async Task ForwardsBoundLaunchUriToExistingInstance()
    {
        var pipeName = $"Hongmeng.WorkOrder.ImportHelper.Tests.{Guid.NewGuid():N}";
        using var coordinator = new SingleInstanceCoordinator(pipeName);
        var received = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
        coordinator.LaunchArgumentReceived += value => received.TrySetResult(value);
        coordinator.Start();
        var launch = $"{AppConstants.ProtocolScheme}://launch?handshakeId={Guid.NewGuid()}&taskId={Guid.NewGuid()}&baseUrl={Uri.EscapeDataString(AppConstants.AllowedWebOrigin)}";

        var forwarded = await SingleInstanceCoordinator.ForwardLaunchArgumentAsync(launch, pipeName);
        var result = await received.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(forwarded);
        Assert.Equal(launch, result);
    }

    [Fact]
    public async Task RejectsForeignSchemeBeforeOpeningPipe()
    {
        var forwarded = await SingleInstanceCoordinator.ForwardLaunchArgumentAsync(
            "https://example.com/not-an-activation",
            $"Hongmeng.WorkOrder.ImportHelper.Tests.{Guid.NewGuid():N}");

        Assert.False(forwarded);
    }

    [Fact]
    public async Task MissingPrimaryReturnsWithinConfiguredTimeout()
    {
        var startedAt = DateTimeOffset.UtcNow;
        var forwarded = await SingleInstanceCoordinator.ForwardLaunchArgumentAsync(
            $"{AppConstants.ProtocolScheme}://ping",
            $"Hongmeng.WorkOrder.ImportHelper.Tests.{Guid.NewGuid():N}",
            TimeSpan.FromMilliseconds(500));

        Assert.False(forwarded);
        Assert.True(DateTimeOffset.UtcNow - startedAt < TimeSpan.FromSeconds(3));
    }
}
