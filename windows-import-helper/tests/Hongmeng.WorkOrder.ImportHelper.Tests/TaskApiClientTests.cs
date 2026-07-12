using System.Net;
using System.Text;
using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class TaskApiClientTests
{
    [Fact]
    public async Task ConnectUsesBoundTaskTicketAndReturnsTaskSummary()
    {
        var taskId = Guid.NewGuid().ToString();
        HttpRequestMessage? captured = null;
        var handler = new StubHandler(request =>
        {
            captured = request;
            var json = """
                {"ok":true,"data":{"taskId":"TASK_ID","createdAt":"2026-07-12T00:00:00Z","expiresAt":"2026-07-12T00:10:00Z","limits":{"maxFiles":20,"maxFileBytes":1048576,"maxTotalBytes":20971520},"workOrder":{"id":"wo","displayCode":"SPEC-1","customerName":"客户","productName":"产品"},"category":{"id":"cat","name":"原图","code":"original"},"summary":{"state":"connected","successCount":0,"duplicateCount":0,"failedCount":0,"processedCount":0,"uploadedBytes":0}}}
                """.Replace("TASK_ID", taskId, StringComparison.Ordinal);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        });
        using var client = new TaskApiClient(handler);
        client.Configure(new Uri(AppConstants.AllowedWebOrigin), taskId, "short-lived-test-ticket");

        var task = await client.ConnectAsync(CancellationToken.None);

        Assert.Equal(taskId, task.TaskId);
        Assert.Equal("connected", task.Summary.State);
        Assert.Equal($"/api/local-import/tasks/{taskId}/connect", captured?.RequestUri?.AbsolutePath);
        Assert.Equal("Bearer", captured?.Headers.Authorization?.Scheme);
        Assert.Equal("short-lived-test-ticket", captured?.Headers.Authorization?.Parameter);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return Task.FromResult(respond(request));
        }
    }
}
