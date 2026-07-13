using System.Text;
using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class DownloadFolderMonitorTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"hongmeng-monitor-tests-{Guid.NewGuid():N}");

    public DownloadFolderMonitorTests() => Directory.CreateDirectory(_directory);

    [Fact]
    public async Task EmitsStableCompletedDownload()
    {
        using var monitor = new DownloadFolderMonitor(TimeSpan.FromMilliseconds(180), TimeSpan.FromMilliseconds(30));
        var detected = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        monitor.FileDetected += path => detected.TrySetResult(path);
        monitor.Start(_directory, DateTimeOffset.UtcNow);
        var path = Path.Combine(_directory, "download.pdf");
        await File.WriteAllBytesAsync(path, Encoding.ASCII.GetBytes("%PDF-stable"));

        var result = await detected.Task.WaitAsync(TimeSpan.FromSeconds(3));

        Assert.Equal(Path.GetFullPath(path), result);
    }

    [Fact]
    public async Task IgnoresPartialDownloadExtensions()
    {
        using var monitor = new DownloadFolderMonitor(TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(20));
        var detected = false;
        monitor.FileDetected += _ => detected = true;
        monitor.Start(_directory, DateTimeOffset.UtcNow);
        await File.WriteAllTextAsync(Path.Combine(_directory, "download.download"), "partial");
        await Task.Delay(350);

        Assert.False(detected);
    }

    [Fact]
    public async Task StopPreventsPendingFileFromBeingEmitted()
    {
        using var monitor = new DownloadFolderMonitor(TimeSpan.FromMilliseconds(400), TimeSpan.FromMilliseconds(30));
        var detected = false;
        monitor.FileDetected += _ => detected = true;
        monitor.Start(_directory, DateTimeOffset.UtcNow);
        await File.WriteAllTextAsync(Path.Combine(_directory, "pending.pdf"), "%PDF-pending");
        monitor.Stop();
        await Task.Delay(550);

        Assert.False(detected);
        Assert.False(monitor.IsRunning);
    }

    [Fact]
    public async Task IgnoresFilesOlderThanTaskCreation()
    {
        var path = Path.Combine(_directory, "old.pdf");
        await File.WriteAllTextAsync(path, "%PDF-old");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddMinutes(-5));
        using var monitor = new DownloadFolderMonitor(TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(20));
        var detected = false;
        monitor.FileDetected += _ => detected = true;

        monitor.Start(_directory, DateTimeOffset.UtcNow);
        await Task.Delay(350);

        Assert.False(detected);
    }

    public void Dispose()
    {
        try { Directory.Delete(_directory, true); } catch { }
    }
}
