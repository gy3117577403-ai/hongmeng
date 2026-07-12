using System.Threading;
using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper;

public partial class App : Application
{
    private Mutex? _singleInstanceMutex;
    private SingleInstanceCoordinator? _coordinator;

    protected override void OnStartup(StartupEventArgs e)
    {
        _singleInstanceMutex = new Mutex(true, AppConstants.SingleInstanceMutex, out var isFirstInstance);
        if (!isFirstInstance)
        {
            SingleInstanceCoordinator.ForwardLaunchArgumentAsync(e.Args.FirstOrDefault()).GetAwaiter().GetResult();
            Shutdown();
            return;
        }

        base.OnStartup(e);
        ProtocolRegistrar.EnsureRegistered();
        _coordinator = new SingleInstanceCoordinator();
        var window = new MainWindow(_coordinator, e.Args.FirstOrDefault());
        MainWindow = window;
        window.Show();
        _coordinator.Start();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _coordinator?.Dispose();
        _singleInstanceMutex?.Dispose();
        base.OnExit(e);
    }
}
