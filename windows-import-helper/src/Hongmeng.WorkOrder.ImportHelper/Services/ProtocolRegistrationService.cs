using System.Diagnostics;
using Microsoft.Win32;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public enum ProtocolRegistrationState
{
    Registered,
    NotRegistered,
    NeedsRepair,
    Error
}

public sealed record ProtocolRegistrationStatus(
    ProtocolRegistrationState State,
    string ExecutablePath,
    string Command,
    string Message);

public interface IProtocolRegistrationStore
{
    bool KeyExists(string subKey);
    string? ReadValue(string subKey, string valueName);
    void WriteValue(string subKey, string valueName, string value);
}

public sealed class CurrentUserProtocolRegistrationStore : IProtocolRegistrationStore
{
    public bool KeyExists(string subKey)
    {
        using var key = Registry.CurrentUser.OpenSubKey(subKey, false);
        return key is not null;
    }

    public string? ReadValue(string subKey, string valueName)
    {
        using var key = Registry.CurrentUser.OpenSubKey(subKey, false);
        return key?.GetValue(valueName, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
    }

    public void WriteValue(string subKey, string valueName, string value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(subKey, true)
            ?? throw new InvalidOperationException("无法打开当前用户协议注册表项");
        key.SetValue(valueName, value, RegistryValueKind.String);
    }
}

public sealed class ProtocolRegistrationService
{
    private const string ProtocolDisplayName = "Hongmeng WorkOrder Import Protocol";
    private readonly IProtocolRegistrationStore _store;
    private readonly Func<string?> _processPathProvider;

    public ProtocolRegistrationService(
        IProtocolRegistrationStore? store = null,
        Func<string?>? processPathProvider = null)
    {
        _store = store ?? new CurrentUserProtocolRegistrationStore();
        _processPathProvider = processPathProvider ?? ResolveCurrentExecutablePath;
    }

    public ProtocolRegistrationStatus EnsureRegistered()
    {
        var status = Inspect();
        return status.State == ProtocolRegistrationState.Registered ? status : RegisterOrRepair();
    }

    public ProtocolRegistrationStatus Inspect()
    {
        try
        {
            var executable = RequireExecutablePath();
            var command = BuildCommand(executable);
            var root = RootKey;
            if (!_store.KeyExists(root))
            {
                return new ProtocolRegistrationStatus(
                    ProtocolRegistrationState.NotRegistered,
                    executable,
                    command,
                    "浏览器协议未注册");
            }

            var valid = string.Equals(_store.ReadValue(root, ""), $"URL:{ProtocolDisplayName}", StringComparison.Ordinal)
                && string.Equals(_store.ReadValue(root, "URL Protocol"), "", StringComparison.Ordinal)
                && string.Equals(_store.ReadValue($"{root}\\DefaultIcon", ""), BuildIcon(executable), StringComparison.OrdinalIgnoreCase)
                && string.Equals(_store.ReadValue($"{root}\\shell\\open\\command", ""), command, StringComparison.OrdinalIgnoreCase);
            return new ProtocolRegistrationStatus(
                valid ? ProtocolRegistrationState.Registered : ProtocolRegistrationState.NeedsRepair,
                executable,
                command,
                valid ? "浏览器协议已注册，无需管理员权限" : "浏览器协议路径需要修复");
        }
        catch (Exception error)
        {
            return ErrorStatus(error);
        }
    }

    public ProtocolRegistrationStatus RegisterOrRepair()
    {
        try
        {
            var executable = RequireExecutablePath();
            var root = RootKey;
            _store.WriteValue(root, "", $"URL:{ProtocolDisplayName}");
            _store.WriteValue(root, "URL Protocol", "");
            _store.WriteValue($"{root}\\DefaultIcon", "", BuildIcon(executable));
            _store.WriteValue($"{root}\\shell\\open\\command", "", BuildCommand(executable));

            var inspected = Inspect();
            return inspected.State == ProtocolRegistrationState.Registered
                ? inspected
                : new ProtocolRegistrationStatus(
                    ProtocolRegistrationState.Error,
                    executable,
                    BuildCommand(executable),
                    "浏览器协议写入后校验失败，请联系 IT 检查当前用户注册表策略");
        }
        catch (Exception error)
        {
            return ErrorStatus(error);
        }
    }

    public ProtocolRegistrationStatus LaunchProtocolTest()
    {
        var status = EnsureRegistered();
        if (status.State != ProtocolRegistrationState.Registered) return status;
        try
        {
            Process.Start(new ProcessStartInfo($"{AppConstants.ProtocolScheme}://ping") { UseShellExecute = true });
            return status with { Message = "已发起浏览器协议测试，等待助手接收 ping" };
        }
        catch (Exception error)
        {
            return ErrorStatus(error);
        }
    }

    public static string BuildCommand(string executablePath) => $"\"{executablePath}\" \"%1\"";

    public static string BuildIcon(string executablePath) => $"\"{executablePath}\",0";

    private static string RootKey => $"Software\\Classes\\{AppConstants.ProtocolScheme}";

    private string RequireExecutablePath()
    {
        var path = _processPathProvider();
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("无法确定助手 EXE 路径");
        return Path.GetFullPath(path);
    }

    private ProtocolRegistrationStatus ErrorStatus(Exception error)
    {
        var executable = _processPathProvider() ?? "";
        var command = string.IsNullOrWhiteSpace(executable) ? "" : BuildCommand(executable);
        return new ProtocolRegistrationStatus(
            ProtocolRegistrationState.Error,
            executable,
            command,
            $"浏览器协议注册失败：{error.Message}");
    }

    private static string? ResolveCurrentExecutablePath()
    {
        return Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
    }
}
