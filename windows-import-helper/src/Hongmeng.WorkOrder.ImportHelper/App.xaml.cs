using Hongmeng.WorkOrder.ImportHelper.Services;

namespace Hongmeng.WorkOrder.ImportHelper;

public partial class App : Application
{
    private CurrentUserInstanceLock? _singleInstanceLock;
    private SingleInstanceCoordinator? _coordinator;
    private ProtocolRegistrationService? _protocolRegistration;

    protected override void OnStartup(StartupEventArgs e)
    {
        var initialArgument = e.Args.FirstOrDefault();
        var existingInstanceReached = SingleInstanceCoordinator.ForwardLaunchArgumentAsync(
            initialArgument,
            timeout: TimeSpan.FromMilliseconds(500)).GetAwaiter().GetResult();
        if (existingInstanceReached) ExitSecondaryInstance();

        _singleInstanceLock = new CurrentUserInstanceLock();
        var isFirstInstance = _singleInstanceLock.TryAcquire();
        if (!isFirstInstance)
        {
            try
            {
                SingleInstanceCoordinator.ForwardLaunchArgumentAsync(initialArgument).GetAwaiter().GetResult();
            }
            finally
            {
                ExitSecondaryInstance();
            }
        }

        base.OnStartup(e);
        _protocolRegistration = new ProtocolRegistrationService();
        var registrationStatus = _protocolRegistration.EnsureRegistered();
        _coordinator = new SingleInstanceCoordinator();
        var window = new MainWindow(_coordinator, _protocolRegistration, registrationStatus, initialArgument);
        MainWindow = window;
        _coordinator.Start();
        window.Show();
    }

    private void ExitSecondaryInstance()
    {
        _singleInstanceLock?.Dispose();
        _singleInstanceLock = null;
        Environment.Exit(0);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _coordinator?.Dispose();
        _singleInstanceLock?.Dispose();
        base.OnExit(e);
    }
}
