using Hongmeng.WorkOrder.ImportHelper.Models;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public static class LaunchRequestParser
{
    public static bool TryParse(string? argument, out LaunchRequest? request)
    {
        request = null;
        if (!TryParseActivation(argument, out var activation) || activation?.Kind != ProtocolActivationKind.Launch) return false;
        request = activation.LaunchRequest;
        return request is not null;
    }

    public static bool TryParseActivation(string? argument, out ProtocolActivation? activation)
    {
        activation = null;
        if (string.IsNullOrWhiteSpace(argument))
        {
            activation = new ProtocolActivation(ProtocolActivationKind.Activate);
            return true;
        }
        if (argument.Length > AppConstants.MaxProtocolUriLength || !Uri.TryCreate(argument, UriKind.Absolute, out var uri)) return false;
        if (!uri.Scheme.Equals(AppConstants.ProtocolScheme, StringComparison.OrdinalIgnoreCase)) return false;
        if (uri.Host.Equals("ping", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return false;
            activation = new ProtocolActivation(ProtocolActivationKind.Ping);
            return true;
        }
        if (!uri.Host.Equals("launch", StringComparison.OrdinalIgnoreCase)
            && !uri.Host.Equals("open", StringComparison.OrdinalIgnoreCase)) return false;

        Dictionary<string, string> query;
        try
        {
            query = ParseQuery(uri.Query);
        }
        catch (UriFormatException)
        {
            return false;
        }
        if (query.ContainsKey("ticket")) return false;
        if (!query.TryGetValue("handshakeId", out var handshakeId) || !Guid.TryParse(handshakeId, out _)) return false;
        if (!query.TryGetValue("taskId", out var taskId) || !Guid.TryParse(taskId, out _)) return false;
        if (!query.TryGetValue("baseUrl", out var baseUrl) || !Uri.TryCreate(baseUrl, UriKind.Absolute, out var baseUri)) return false;
        if (!baseUri.GetLeftPart(UriPartial.Authority).Equals(AppConstants.AllowedWebOrigin, StringComparison.OrdinalIgnoreCase)) return false;
        activation = new ProtocolActivation(
            ProtocolActivationKind.Launch,
            new LaunchRequest(handshakeId, taskId, new Uri(baseUri.GetLeftPart(UriPartial.Authority))));
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
