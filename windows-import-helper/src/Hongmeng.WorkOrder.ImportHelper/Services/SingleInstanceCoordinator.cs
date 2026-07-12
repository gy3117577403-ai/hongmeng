using System.IO.Pipes;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class SingleInstanceCoordinator : IDisposable
{
    private readonly CancellationTokenSource _cancellation = new();
    private Task? _serverTask;

    public event Action<string?>? LaunchArgumentReceived;

    public void Start()
    {
        _serverTask ??= Task.Run(() => RunServerAsync(_cancellation.Token));
    }

    public static async Task ForwardLaunchArgumentAsync(string? argument)
    {
        try
        {
            await using var client = new NamedPipeClientStream(
                ".",
                AppConstants.LaunchPipeName,
                PipeDirection.Out,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await client.ConnectAsync(timeout.Token);
            await using var writer = new StreamWriter(client) { AutoFlush = true };
            await writer.WriteLineAsync(argument ?? string.Empty);
        }
        catch
        {
            // The first process may still be starting. The browser can retry the protocol launch.
        }
    }

    private async Task RunServerAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    AppConstants.LaunchPipeName,
                    PipeDirection.In,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(cancellationToken);
                using var reader = new StreamReader(server);
                var argument = await reader.ReadLineAsync(cancellationToken);
                LaunchArgumentReceived?.Invoke(argument);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                await Task.Delay(300, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    public void Dispose()
    {
        _cancellation.Cancel();
        try { _serverTask?.Wait(TimeSpan.FromSeconds(1)); } catch { }
        _cancellation.Dispose();
    }
}
