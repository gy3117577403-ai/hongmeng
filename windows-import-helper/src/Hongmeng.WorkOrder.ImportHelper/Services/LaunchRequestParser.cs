using Hongmeng.WorkOrder.ImportHelper.Models;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public static class LaunchRequestParser
{
    public static bool TryParse(string? argument, out LaunchRequest? request)
    {
        request = null;
        if (string.IsNullOrWhiteSpace(argument) || !Uri.TryCreate(argument, UriKind.Absolute, out var uri)) return false;
        if (!uri.Scheme.Equals(AppConstants.ProtocolScheme, StringComparison.OrdinalIgnoreCase)) return false;
        if (!uri.Host.Equals("open", StringComparison.OrdinalIgnoreCase)) return false;
        var query = ParseQuery(uri.Query);
        if (!query.TryGetValue("handshakeId", out var handshakeId) || !Guid.TryParse(handshakeId, out _)) return false;
        if (!query.TryGetValue("taskId", out var taskId) || !Guid.TryParse(taskId, out _)) return false;
        if (!query.TryGetValue("baseUrl", out var baseUrl) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri)) return false;
        if (!baseUri.GetLeftPart(UriPartial.Authority).Equals(AppConstants.AllowedWebOrigin, StringComparison.OrdinalIgnoreCase)) return false;
        request = new LaunchRequest(handshakeId, taskId, new Uri(baseUri.GetLeftPart(UriPartial.Authority)));
        return true;
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            values[Uri.UnescapeDataString(parts[0])] = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "";
        }
        return values;
    }
}
