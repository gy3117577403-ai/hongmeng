using System.Net;
using System.Text.Json;
using Hongmeng.WorkOrder.ImportHelper.Models;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class LoopbackHandoffServer : IAsyncDisposable
{
    private readonly object _gate = new();
    private readonly Dictionary<string, PendingHandshake> _pending = new(StringComparer.OrdinalIgnoreCase);
    private WebApplication? _application;

    public event Action<HandoffPayload>? HandoffReceived;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (_application is not null) return;

        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 17651));
        var app = builder.Build();

        app.Use(async (context, next) =>
        {
            var origin = context.Request.Headers.Origin.ToString();
            if (origin.Equals(AppConstants.AllowedWebOrigin, StringComparison.OrdinalIgnoreCase))
            {
                context.Response.Headers["Access-Control-Allow-Origin"] = AppConstants.AllowedWebOrigin;
                context.Response.Headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
                context.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
                context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
                context.Response.Headers["Vary"] = "Origin";
            }

            if (HttpMethods.IsOptions(context.Request.Method))
            {
                context.Response.StatusCode = origin.Equals(AppConstants.AllowedWebOrigin, StringComparison.OrdinalIgnoreCase)
                    ? StatusCodes.Status204NoContent
                    : StatusCodes.Status403Forbidden;
                return;
            }

            await next();
        });

        app.MapGet("/health", () => Results.Json(new { ok = true }));
        app.MapPost("/handoff", (Func<HttpContext, Task<IResult>>)HandleHandoffAsync);
        await app.StartAsync(cancellationToken);
        _application = app;
    }

    public void Expect(LaunchRequest request)
    {
        lock (_gate)
        {
            RemoveExpiredLocked();
            _pending[request.HandshakeId] = new PendingHandshake(request, DateTimeOffset.UtcNow.AddSeconds(30));
        }
    }

    private async Task<IResult> HandleHandoffAsync(HttpContext context)
    {
        var origin = context.Request.Headers.Origin.ToString();
        if (!origin.Equals(AppConstants.AllowedWebOrigin, StringComparison.OrdinalIgnoreCase))
        {
            return Results.Json(new { ok = false, error = "origin_not_allowed" }, statusCode: StatusCodes.Status403Forbidden);
        }

        if (context.Request.ContentLength is > 16_384)
        {
            return Results.Json(new { ok = false, error = "payload_too_large" }, statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        HandoffPayload? payload;
        try
        {
            payload = await JsonSerializer.DeserializeAsync<HandoffPayload>(
                context.Request.Body,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true },
                context.RequestAborted);
        }
        catch (JsonException)
        {
            return Results.Json(new { ok = false, error = "invalid_json" }, statusCode: StatusCodes.Status400BadRequest);
        }

        if (payload is null || string.IsNullOrWhiteSpace(payload.Ticket) || payload.Ticket.Length > 8_192)
        {
            return Results.Json(new { ok = false, error = "invalid_handoff" }, statusCode: StatusCodes.Status400BadRequest);
        }

        PendingHandshake? expected;
        lock (_gate)
        {
            RemoveExpiredLocked();
            _pending.TryGetValue(payload.HandshakeId, out expected);
            if (expected is not null
                && expected.Request.TaskId.Equals(payload.TaskId, StringComparison.OrdinalIgnoreCase)
                && expected.Request.BaseUrl.GetLeftPart(UriPartial.Authority).Equals(payload.BaseUrl.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
            {
                _pending.Remove(payload.HandshakeId);
            }
            else
            {
                expected = null;
            }
        }

        if (expected is null)
        {
            return Results.Json(new { ok = false, error = "handshake_not_expected" }, statusCode: StatusCodes.Status403Forbidden);
        }

        HandoffReceived?.Invoke(payload);
        return Results.Json(new { ok = true });
    }

    private void RemoveExpiredLocked()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var key in _pending.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray())
        {
            _pending.Remove(key);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_application is null) return;
        try { await _application.StopAsync(TimeSpan.FromSeconds(2)); } catch { }
        await _application.DisposeAsync();
        _application = null;
    }

    private sealed record PendingHandshake(LaunchRequest Request, DateTimeOffset ExpiresAt);
}
