using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Hongmeng.WorkOrder.ImportHelper.Services;

public sealed class ProcessIntegritySnapshot
{
    public string Current { get; init; } = "未知";
    public string Explorer { get; init; } = "未运行或不可读取";
    public string WeCom { get; init; } = "未运行或不可读取";
    public bool CurrentIsElevated { get; init; }

    public string DisplayText => $"助手: {Current} / Explorer: {Explorer} / 企业微信: {WeCom}";
}

public static class ProcessIntegrityInspector
{
    private const uint TokenQuery = 0x0008;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const int TokenIntegrityLevel = 25;

    public static ProcessIntegritySnapshot Capture()
    {
        var current = TryReadCurrent();
        return new ProcessIntegritySnapshot
        {
            Current = current,
            Explorer = TryReadFirstProcess("explorer"),
            WeCom = TryReadFirstProcess("WXWork", "WeCom"),
            CurrentIsElevated = current is "高" or "系统",
        };
    }

    private static string TryReadCurrent()
    {
        using var process = Process.GetCurrentProcess();
        return TryReadProcess(process.Id);
    }

    private static string TryReadFirstProcess(params string[] names)
    {
        foreach (var name in names)
        {
            foreach (var process in Process.GetProcessesByName(name))
            {
                using (process)
                {
                    var value = TryReadProcess(process.Id);
                    if (value != "不可读取") return value;
                }
            }
        }
        return "未运行或不可读取";
    }

    private static string TryReadProcess(int processId)
    {
        var process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) return "不可读取";
        try
        {
            if (!OpenProcessToken(process, TokenQuery, out var token)) return "不可读取";
            try
            {
                GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out var length);
                if (length <= 0) return "不可读取";
                var buffer = Marshal.AllocHGlobal(length);
                try
                {
                    if (!GetTokenInformation(token, TokenIntegrityLevel, buffer, length, out _)) return "不可读取";
                    var sid = Marshal.ReadIntPtr(buffer);
                    var countPointer = GetSidSubAuthorityCount(sid);
                    if (countPointer == IntPtr.Zero) return "不可读取";
                    var count = Marshal.ReadByte(countPointer);
                    if (count == 0) return "不可读取";
                    var ridPointer = GetSidSubAuthority(sid, (uint)(count - 1));
                    var rid = ridPointer == IntPtr.Zero ? 0 : (uint)Marshal.ReadInt32(ridPointer);
                    return rid switch
                    {
                        < 0x1000 => "不受信任",
                        < 0x2000 => "低",
                        < 0x3000 => "中",
                        < 0x4000 => "高",
                        _ => "系统",
                    };
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                CloseHandle(token);
            }
        }
        finally
        {
            CloseHandle(process);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, IntPtr tokenInformation, int tokenInformationLength, out int returnLength);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuthority);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
