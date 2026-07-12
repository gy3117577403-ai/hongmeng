using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class CurrentUserInstanceLockTests
{
    [Fact]
    public void AllowsOnlyOneOwnerAndRecoversAfterExit()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"hongmeng-instance-test-{Guid.NewGuid():N}");
        try
        {
            using var first = new CurrentUserInstanceLock(directory);
            using var second = new CurrentUserInstanceLock(directory);
            Assert.True(first.TryAcquire());
            Assert.False(second.TryAcquire());

            first.Dispose();
            using var replacement = new CurrentUserInstanceLock(directory);
            Assert.True(replacement.TryAcquire());
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
