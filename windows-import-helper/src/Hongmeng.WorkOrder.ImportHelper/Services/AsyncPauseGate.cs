namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class AsyncPauseGate
{
    private volatile TaskCompletionSource _source = CreateCompletedSource();

    public bool IsPaused => !_source.Task.IsCompleted;

    public Task WaitAsync(CancellationToken cancellationToken) => _source.Task.WaitAsync(cancellationToken);

    public void Pause()
    {
        if (IsPaused) return;
        Interlocked.Exchange(ref _source, new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
    }

    public void Resume() => _source.TrySetResult();

    private static TaskCompletionSource CreateCompletedSource()
    {
        var source = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        source.SetResult();
        return source;
    }
}
