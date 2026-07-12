using System.Text.Json;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class HelperSettings
{
    public string DownloadFolder { get; set; } = "";
}
public sealed class UserSettingsStore
{
    private readonly string _settingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Hongmeng.WorkOrder.ImportHelper",
        "settings.json");

    public HelperSettings Load()
    {
        try
        {
            return File.Exists(_settingsPath)
                ? JsonSerializer.Deserialize<HelperSettings>(File.ReadAllText(_settingsPath)) ?? new HelperSettings()
                : new HelperSettings();
        }
        catch
        {
            return new HelperSettings();
        }
    }

    public void Save(HelperSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_settingsPath)!);
        File.WriteAllText(_settingsPath, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
    }
}
