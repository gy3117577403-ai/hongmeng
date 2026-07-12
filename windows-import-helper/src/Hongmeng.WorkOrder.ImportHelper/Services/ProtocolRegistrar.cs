using Microsoft.Win32;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public static class ProtocolRegistrar
{
    public static void EnsureRegistered()
    {
        try
        {
            var executable = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executable)) return;
            using var protocol = Registry.CurrentUser.CreateSubKey($"Software\\Classes\\{AppConstants.ProtocolScheme}");
            protocol.SetValue("", $"URL:{AppConstants.AppName}");
            protocol.SetValue("URL Protocol", "");
            using var command = protocol.CreateSubKey("shell\\open\\command");
            command.SetValue("", $"\"{executable}\" \"%1\"");
        }
        catch
        {
            // Portable mode remains usable when protocol registration is blocked.
        }
    }
}
