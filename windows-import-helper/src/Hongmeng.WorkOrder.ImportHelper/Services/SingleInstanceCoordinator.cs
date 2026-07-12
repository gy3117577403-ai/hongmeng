using System.IO.Pipes;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class SingleInstanceCoordinator : IDisposable
{
    private readonly CancellationTokenSource _cancellation = new();
    private readonly string _pipeName;
    private Task? _serverTask;

    public SingleInstanceCoordinator(string? pipeName = null)
    {
        _pipeName = string.IsNullOrWhiteSpace(pipeName) ? AppConstants.LaunchPipeName : pipeName;
    }

    public event Action<string?>? LaunchArgumentReceived;

    public void Start()
    {
        _serverTask ??= Task.Run(() => RunServerAsync(_cancellation.Token));
    }

    public static async Task<bool> ForwardLaunchArgumentAsync(
        string? argument,
        string? pipeName = null,
        TimeSpan? timeout = null)
    {
        if (!LaunchRequestParser.TryParseActivation(argument, out _)) return false;
        using var deadline = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(3));
        while (!deadline.IsCancellationRequested)
        {
            try
            {
                await using var client = new NamedPipeClientStream(
                    ".",
                    string.IsNullOrWhiteSpace(pipeName) ? AppConstants.LaunchPipeName : pipeName,
                    PipeDirection.Out,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await client.ConnectAsync(400, deadline.Token).ConfigureAwait(false);
                await ActivationMessageCodec.WriteAsync(client, argument ?? string.Empty, deadline.Token).ConfigureAwait(false);
                return true;
            }
            catch (OperationCanceledException) when (!deadline.IsCancellationRequested)
            {
                await Task.Delay(100, deadline.Token).ConfigureAwait(false);
            }
            catch (IOException) when (!deadline.IsCancellationRequested)
            {
                await Task.Delay(100, deadline.Token).ConfigureAwait(false);
            }
            catch
            {
                return false;
            }
        }
        return false;
    }

    private async Task RunServerAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    _pipeName,
                    PipeDirection.In,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(cancellationToken);
                var argument = await ActivationMessageCodec.ReadAsync(server, cancellationToken);
                if (LaunchRequestParser.TryParseActivation(argument, out _)) LaunchArgumentReceived?.Invoke(argument);
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
