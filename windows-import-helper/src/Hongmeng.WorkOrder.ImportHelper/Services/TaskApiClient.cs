using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Hongmeng.WorkOrder.ImportHelper.Models;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class ImportApiException : Exception
{
    public ImportApiException(string message, int statusCode, string code = "") : base(message)
    {
        StatusCode = statusCode;
        Code = code;
    }

    public int StatusCode { get; }
    public string Code { get; }
}

public sealed class TaskApiClient : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly HttpClient _client = new() { Timeout = TimeSpan.FromMinutes(10) };
    private Uri? _baseUrl;
    private string _taskId = "";
    private string _ticket = "";

    public bool IsConfigured => _baseUrl is not null && _taskId.Length > 0 && _ticket.Length > 0;

    public void Configure(Uri baseUrl, string taskId, string ticket)
    {
        var origin = baseUrl.GetLeftPart(UriPartial.Authority);
        if (!origin.Equals(AppConstants.AllowedWebOrigin, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("任务服务地址不在允许列表中");
        }
        _baseUrl = new Uri(origin);
        _taskId = taskId;
        _ticket = ticket;
    }

    public void Clear()
    {
        _baseUrl = null;
        _taskId = "";
        _ticket = "";
    }

    public Task<TaskDetails> GetTaskAsync(CancellationToken cancellationToken) =>
        SendAsync<TaskDetails>(HttpMethod.Get, TaskPath(), null, cancellationToken);

    public Task<DuplicateCheckResult> CheckAsync(DuplicateCheckRequest request, CancellationToken cancellationToken) =>
        SendAsync<DuplicateCheckResult>(HttpMethod.Post, $"{TaskPath()}/check", request, cancellationToken);

    public async Task SetStatusAsync(string state, CancellationToken cancellationToken)
    {
        await SendAsync<StatusUpdateResult>(HttpMethod.Post, $"{TaskPath()}/status", new StatusUpdateRequest { State = state }, cancellationToken);
    }

    public async Task<UploadResult> UploadAsync(FileQueueItem item, Action<double> progress, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        using var request = new HttpRequestMessage(HttpMethod.Post, BuildUri($"{TaskPath()}/files"));
        ApplyAuthorization(request);
        using var multipart = new MultipartFormDataContent();
        var stream = new FileStream(item.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var content = new ProgressStreamContent(stream, item.Size, (sent, total) => progress(total == 0 ? 0 : sent * 100d / total));
        content.Headers.ContentType = MediaTypeHeaderValue.Parse(item.MimeType);
        multipart.Add(content, "file", item.FileName);
        multipart.Add(new StringContent(item.Sha256), "sha256");
        multipart.Add(new StringContent(item.MimeType), "mimeType");
        multipart.Add(new StringContent(item.AllowConflictUpload ? "true" : "false"), "confirmConflict");
        request.Content = multipart;
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancellationToken);
        return await ReadEnvelopeAsync<UploadResult>(response, cancellationToken);
    }

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        using var request = new HttpRequestMessage(method, BuildUri(path));
        ApplyAuthorization(request);
        if (body is not null) request.Content = JsonContent.Create(body, options: JsonOptions);
        using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancellationToken);
        return await ReadEnvelopeAsync<T>(response, cancellationToken);
    }

    private static async Task<T> ReadEnvelopeAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        ApiEnvelope<T>? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<ApiEnvelope<T>>(body, JsonOptions);
        }
        catch (JsonException)
        {
            throw new ImportApiException("服务器返回非 JSON 数据，请检查网络或服务版本", (int)response.StatusCode);
        }

        if (!response.IsSuccessStatusCode || envelope?.Ok != true || envelope.Data is null)
        {
            var message = envelope?.Error ?? envelope?.Message ?? $"请求失败（HTTP {(int)response.StatusCode}）";
            throw new ImportApiException(message, (int)response.StatusCode, envelope?.Code ?? "");
        }
        return envelope.Data;
    }

    private void ApplyAuthorization(HttpRequestMessage request)
    {
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _ticket);
        request.Headers.UserAgent.ParseAdd("Hongmeng-WorkOrder-ImportHelper/1.16.5");
    }

    private string TaskPath() => $"/api/local-import/tasks/{Uri.EscapeDataString(_taskId)}";

    private Uri BuildUri(string path)
    {
        EnsureConfigured();
        return new Uri(_baseUrl!, path);
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured) throw new InvalidOperationException("请先从工单资料库网页创建导入任务");
    }

    public void Dispose()
    {
        Clear();
        _client.Dispose();
    }
}
