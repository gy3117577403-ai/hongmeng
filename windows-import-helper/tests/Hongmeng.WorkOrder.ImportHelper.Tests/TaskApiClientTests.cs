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
        const string helperInstanceId = "helper-instance-test-000000000001";
        HttpRequestMessage? captured = null;
        string? capturedBody = null;
        var handler = new StubHandler(request =>
        {
            captured = request;
            capturedBody = request.Content?.ReadAsStringAsync().GetAwaiter().GetResult();
            var json = """
                {"ok":true,"data":{"ticket":"bound-ticket","alreadyConnected":false,"task":{"taskId":"TASK_ID","createdAt":"2026-07-12T00:00:00Z","expiresAt":"2026-07-12T00:10:00Z","limits":{"maxFiles":20,"maxFileBytes":1048576,"maxTotalBytes":20971520},"workOrder":{"id":"wo","displayCode":"SPEC-1","customerName":"客户","productName":"产品"},"category":{"id":"cat","name":"原图","code":"original"},"summary":{"state":"connected","successCount":0,"duplicateCount":0,"failedCount":0,"processedCount":0,"uploadedBytes":0}}}}
                """.Replace("TASK_ID", taskId, StringComparison.Ordinal);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        });
        using var client = new TaskApiClient(helperInstanceId, handler);
        client.Configure(new Uri(AppConstants.AllowedWebOrigin), taskId, "short-lived-test-ticket");

        var connected = await client.ConnectAsync(CancellationToken.None);

        Assert.Equal(taskId, connected.Task.TaskId);
        Assert.Equal("connected", connected.Task.Summary.State);
        Assert.Equal("bound-ticket", connected.Ticket);
        Assert.Equal($"/api/local-import/tasks/{taskId}/connect", captured?.RequestUri?.AbsolutePath);
        Assert.Equal("Bearer", captured?.Headers.Authorization?.Scheme);
        Assert.Equal("short-lived-test-ticket", captured?.Headers.Authorization?.Parameter);
        Assert.Contains(helperInstanceId, capturedBody);
    }

    [Fact]
    public async Task PairRetryAfterNetworkFailureUsesSameHelperInstanceId()
    {
        const string helperInstanceId = "helper-instance-test-000000000002";
        var attempts = 0;
        var requestBodies = new List<string>();
        var handler = new StubHandler(request =>
        {
            attempts += 1;
            requestBodies.Add(request.Content?.ReadAsStringAsync().GetAwaiter().GetResult() ?? "");
            if (attempts == 1) throw new HttpRequestException("simulated connection reset");
            var json = """
                {"ok":true,"data":{"taskId":"task-1","ticket":"bound-ticket","baseUrl":"https://qdowqencjyph.sealoshzh.site","expiresAt":"2026-07-13T04:10:00Z","alreadyConnected":true,"task":{"taskId":"task-1","createdAt":"2026-07-13T04:00:00Z","expiresAt":"2026-07-13T04:10:00Z","limits":{"maxFiles":20,"maxFileBytes":1048576,"maxTotalBytes":20971520},"workOrder":{"id":"wo","displayCode":"SPEC-1","customerName":"客户","productName":"产品"},"category":{"id":"cat","name":"原图","code":"original"},"summary":{"state":"connected","successCount":0,"duplicateCount":0,"failedCount":0,"processedCount":0,"uploadedBytes":0}}}}
                """;
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        });
        using var client = new TaskApiClient(helperInstanceId, handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            client.PairAsync(new Uri(AppConstants.AllowedWebOrigin), "123456", CancellationToken.None));
        var retried = await client.PairAsync(new Uri(AppConstants.AllowedWebOrigin), "123456", CancellationToken.None);

        Assert.True(retried.AlreadyConnected);
        Assert.Equal("task-1", retried.Task.TaskId);
        Assert.Equal(2, requestBodies.Count);
        Assert.All(requestBodies, body => Assert.Contains(helperInstanceId, body));
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            return Task.FromResult(respond(request));
        }
    }
}
