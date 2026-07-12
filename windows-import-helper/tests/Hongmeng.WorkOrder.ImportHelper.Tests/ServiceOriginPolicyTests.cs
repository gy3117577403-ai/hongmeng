using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class ServiceOriginPolicyTests
{
    [Theory]
    [InlineData("https://qdowqencjyph.sealoshzh.site")]
    [InlineData("https://qdowqencjyph.sealoshzh.site/")]
    [InlineData("https://QDOWQENCJYPH.SEALOSHZH.SITE")]
    [InlineData("https://qdowqencjyph.sealoshzh.site:443")]
    [InlineData("https://qdowqencjyph.sealoshzh.site/api/local-import/tasks/pair")]
    public void NormalizesAllowedProductionUrls(string input)
    {
        var normalized = ServiceOriginPolicy.NormalizeOrigin(input);

        Assert.Equal(AppConstants.OfficialServiceOrigin, normalized.AbsoluteUri.TrimEnd('/'));
    }

    [Theory]
    [InlineData("http://qdowqencjyph.sealoshzh.site")]
    [InlineData("https://qdowqencjyph.sealoshzh.site.evil.com")]
    [InlineData("https://evil-qdowqencjyph.sealoshzh.site")]
    [InlineData("https://evil.com/qdowqencjyph.sealoshzh.site")]
    [InlineData("https://user:pass@qdowqencjyph.sealoshzh.site")]
    [InlineData("https://qdowqencjyph.sealoshzh.site:8443")]
    [InlineData("file:///C:/temp/task.json")]
    [InlineData("ftp://qdowqencjyph.sealoshzh.site/task")]
    [InlineData("javascript:alert(1)")]
    [InlineData("")]
    [InlineData("/api/local-import/tasks/pair")]
    [InlineData("not a valid URL")]
    public void RejectsUntrustedUrls(string input)
    {
        Assert.False(ServiceOriginPolicy.TryNormalizeAllowedOrigin(input, out _));
        Assert.Throws<ServiceOriginNotAllowedException>(() => ServiceOriginPolicy.NormalizeOrigin(input));
    }
}
