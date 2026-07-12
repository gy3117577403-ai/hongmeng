using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class HelperInstanceIdentityTests
{
    [Fact]
    public void PersistsStableCurrentUserIdentity()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"hongmeng-helper-identity-{Guid.NewGuid():N}");
        var path = Path.Combine(directory, "helper-instance-id.txt");
        try
        {
            var service = new HelperInstanceIdentity(path);

            var first = service.GetOrCreate();
            var second = service.GetOrCreate();

            Assert.Equal(first, second);
            Assert.Equal(32, first.Length);
            Assert.Equal(first, File.ReadAllText(path));
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
