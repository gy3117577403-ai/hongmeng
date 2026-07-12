namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class ServiceOriginNotAllowedException : InvalidOperationException
{
    public ServiceOriginNotAllowedException() : base("任务服务地址不在允许列表中")
    {
    }
}

public static class ServiceOriginPolicy
{
    public static Uri GetOfficialServiceOrigin() => new(AppConstants.OfficialServiceOrigin, UriKind.Absolute);

    public static Uri NormalizeOrigin(string input)
    {
        if (!TryNormalizeAllowedOrigin(input, out var origin) || origin is null)
        {
            throw new ServiceOriginNotAllowedException();
        }

        return origin;
    }

    public static Uri NormalizeOrigin(Uri input)
    {
        if (!TryNormalizeAllowedOrigin(input, out var origin) || origin is null)
        {
            throw new ServiceOriginNotAllowedException();
        }

        return origin;
    }

    public static bool IsAllowedServiceOrigin(Uri input) => TryNormalizeAllowedOrigin(input, out _);

    public static bool TryNormalizeAllowedOrigin(string? input, out Uri? origin)
    {
        origin = null;
        return !string.IsNullOrWhiteSpace(input)
            && Uri.TryCreate(input, UriKind.Absolute, out var parsed)
            && TryNormalizeAllowedOrigin(parsed, out origin);
    }

    public static bool TryNormalizeAllowedOrigin(Uri? input, out Uri? origin)
    {
        origin = null;
        if (input is null || !input.IsAbsoluteUri) return false;
        if (!input.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return false;
        if (!string.IsNullOrEmpty(input.UserInfo)) return false;
        if (!input.IdnHost.Equals(AppConstants.OfficialServiceHost, StringComparison.OrdinalIgnoreCase)) return false;
        if (input.Port != 443) return false;

        origin = GetOfficialServiceOrigin();
        return true;
    }
}
