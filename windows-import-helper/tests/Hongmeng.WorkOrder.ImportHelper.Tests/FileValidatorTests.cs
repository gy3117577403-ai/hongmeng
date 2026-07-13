using System.Text;
using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class FileValidatorTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"hongmeng-helper-tests-{Guid.NewGuid():N}");

    public FileValidatorTests() => Directory.CreateDirectory(_directory);

    [Fact]
    public async Task AcceptsPdfHeaderAndComputesSha256()
    {
        var path = Path.Combine(_directory, "测试资料.pdf");
        await File.WriteAllBytesAsync(path, Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF\n"));

        var result = await new FileValidator().ValidateAsync(path, 1024 * 1024, CancellationToken.None);

        Assert.True(result.IsValid, result.Error);
        Assert.Equal("application/pdf", result.MimeType);
        Assert.Equal(64, result.Sha256.Length);
    }

    [Fact]
    public async Task RejectsInvalidPdfHeader()
    {
        var path = Path.Combine(_directory, "bad.pdf");
        await File.WriteAllTextAsync(path, "not a pdf");

        var result = await new FileValidator().ValidateAsync(path, 1024 * 1024, CancellationToken.None);

        Assert.False(result.IsValid);
        Assert.Contains("文件头", result.Error);
    }

    [Theory]
    [InlineData("download.tmp")]
    [InlineData("download.part")]
    [InlineData("download.crdownload")]
    [InlineData("download.download")]
    public void IdentifiesTemporaryDownloads(string fileName)
    {
        Assert.True(FileValidator.IsTemporaryFile(Path.Combine(_directory, fileName)));
    }

    public void Dispose()
    {
        try { Directory.Delete(_directory, true); } catch { }
    }
}
