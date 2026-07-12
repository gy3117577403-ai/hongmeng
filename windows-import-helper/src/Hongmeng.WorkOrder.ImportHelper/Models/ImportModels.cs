using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace Hongmeng.WorkOrder.ImportHelper.Models;

public sealed record LaunchRequest(string HandshakeId, string TaskId, Uri BaseUrl);

public sealed class HandoffPayload
{
    public string HandshakeId { get; set; } = "";
    public string TaskId { get; set; } = "";
    public string Ticket { get; set; } = "";
    public string BaseUrl { get; set; } = "";
}

public sealed class ApiEnvelope<T>
{
    public bool Ok { get; set; }
    public T? Data { get; set; }
    public string? Error { get; set; }
    public string? Message { get; set; }
    public string? Code { get; set; }
}

public sealed class TaskDetails
{
    public string TaskId { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public TaskLimits Limits { get; set; } = new();
    public WorkOrderTarget WorkOrder { get; set; } = new();
    public CategoryTarget Category { get; set; } = new();
    public TaskSummary Summary { get; set; } = new();
}

public sealed class TaskLimits
{
    public int MaxFiles { get; set; }
    public long MaxFileBytes { get; set; }
    public long MaxTotalBytes { get; set; }
}

public sealed class WorkOrderTarget
{
    public string Id { get; set; } = "";
    public string DisplayCode { get; set; } = "";
    public string CustomerName { get; set; } = "";
    public string ProductName { get; set; } = "";
}

public sealed class CategoryTarget
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
}

public sealed class TaskSummary
{
    public string State { get; set; } = "waiting";
    public int SuccessCount { get; set; }
    public int DuplicateCount { get; set; }
    public int FailedCount { get; set; }
    public int ProcessedCount { get; set; }
    public long UploadedBytes { get; set; }
    public string? LatestFileId { get; set; }
}

public sealed class StatusUpdateRequest
{
    public string State { get; set; } = "waiting";
}

public sealed class StatusUpdateResult
{
    public TaskSummary Summary { get; set; } = new();
}

public sealed class DuplicateCheckRequest
{
    public string FileName { get; set; } = "";
    public long Size { get; set; }
    public string Sha256 { get; set; } = "";
    public string MimeType { get; set; } = "";
}

public sealed class DuplicateCheckResult
{
    public string Status { get; set; } = "new";
    public string? ExistingFileId { get; set; }
    public string? ExistingVersion { get; set; }
    public string SuggestedVersion { get; set; } = "V1.0";
    public string Reason { get; set; } = "";
}

public sealed class UploadResult
{
    public bool Skipped { get; set; }
    public string DuplicateStatus { get; set; } = "new";
    public UploadedResourceFile? ResourceFile { get; set; }
    public DrawingLibrarySyncResult? DrawingLibrarySync { get; set; }
}

public sealed class UploadedResourceFile
{
    public string Id { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string Version { get; set; } = "V1.0";
}

public sealed class DrawingLibrarySyncResult
{
    public bool Linked { get; set; }
    public bool Skipped { get; set; }
    public string? Error { get; set; }
}

public sealed class FileValidationResult
{
    public bool IsValid { get; init; }
    public string Error { get; init; } = "";
    public string MimeType { get; init; } = "";
    public string Sha256 { get; init; } = "";
    public long Size { get; init; }
}

public sealed class FileQueueItem : INotifyPropertyChanged
{
    private string _status = "等待校验";
    private string _message = "";
    private string _duplicateStatus = "-";
    private string _mimeType = "";
    private string _sha256 = "";
    private long _size;
    private double _progress;
    private bool _allowConflictUpload;

    public string Path { get; init; } = "";
    public string FileName { get; init; } = "";
    public string MimeType { get => _mimeType; set => SetField(ref _mimeType, value); }
    public string Sha256 { get => _sha256; set => SetField(ref _sha256, value); }
    public long Size { get => _size; set => SetField(ref _size, value); }

    public string Status { get => _status; set => SetField(ref _status, value); }
    public string Message { get => _message; set => SetField(ref _message, value); }
    public string DuplicateStatus { get => _duplicateStatus; set => SetField(ref _duplicateStatus, value); }
    public double Progress { get => _progress; set => SetField(ref _progress, value); }
    public bool AllowConflictUpload { get => _allowConflictUpload; set => SetField(ref _allowConflictUpload, value); }
    public string SizeText => Size < 1024 * 1024 ? $"{Size / 1024d:F1} KB" : $"{Size / 1024d / 1024d:F2} MB";
    [JsonIgnore] public bool CanUpload => Status is "等待上传" or "上传失败" || (Status == "需要确认" && AllowConflictUpload);

    public event PropertyChangedEventHandler? PropertyChanged;

    private void SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        if (propertyName is nameof(Size)) PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SizeText)));
        if (propertyName is nameof(Status) or nameof(AllowConflictUpload)) PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CanUpload)));
    }
}
