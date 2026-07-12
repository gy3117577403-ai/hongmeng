using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper.Tests;

public sealed class ProtocolRegistrationServiceTests
{
    [Fact]
    public void RegistersCurrentUserValuesAndRepairsMovedExecutable()
    {
        var store = new MemoryProtocolStore();
        var executable = @"C:\Users\worker\Apps\Helper.exe";
        var service = new ProtocolRegistrationService(store, () => executable);

        var first = service.EnsureRegistered();

        Assert.Equal(ProtocolRegistrationState.Registered, first.State);
        Assert.Equal("\"C:\\Users\\worker\\Apps\\Helper.exe\" \"%1\"", first.Command);
        Assert.Equal("\"C:\\Users\\worker\\Apps\\Helper.exe\",0", store.ReadValue(Root + "\\DefaultIcon", ""));

        executable = @"D:\Tools\Helper.exe";
        Assert.Equal(ProtocolRegistrationState.NeedsRepair, service.Inspect().State);
        var repaired = service.EnsureRegistered();

        Assert.Equal(ProtocolRegistrationState.Registered, repaired.State);
        Assert.Equal("\"D:\\Tools\\Helper.exe\" \"%1\"", store.ReadValue(Root + "\\shell\\open\\command", ""));
    }

    private static string Root => $"Software\\Classes\\{AppConstants.ProtocolScheme}";

    private sealed class MemoryProtocolStore : IProtocolRegistrationStore
    {
        private readonly Dictionary<string, Dictionary<string, string>> _keys = new(StringComparer.OrdinalIgnoreCase);

        public bool KeyExists(string subKey) => _keys.ContainsKey(subKey);

        public string? ReadValue(string subKey, string valueName)
        {
            return _keys.TryGetValue(subKey, out var values) && values.TryGetValue(valueName, out var value) ? value : null;
        }

        public void WriteValue(string subKey, string valueName, string value)
        {
            if (!_keys.TryGetValue(subKey, out var values))
            {
                values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                _keys[subKey] = values;
            }
            values[valueName] = value;
        }
    }
}
