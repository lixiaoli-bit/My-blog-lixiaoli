param([int]$TargetProcessId, [string]$ExpectedExecutable)
$taskProcess = Get-Process -Id $TargetProcessId -ErrorAction Stop
if ($taskProcess.Path -ne (Resolve-Path -LiteralPath $ExpectedExecutable).Path) { throw 'Native drag cancellation target is not the isolated test executable' }
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class ArticleDragCancel {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc fn, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static void Cancel(uint target) {
    EnumWindows((h,p) => { uint pid; GetWindowThreadProcessId(h,out pid);
      if (pid==target) { PostMessage(h,0x100,(IntPtr)27,IntPtr.Zero); PostMessage(h,0x101,(IntPtr)27,IntPtr.Zero); PostMessage(h,0x1f,IntPtr.Zero,IntPtr.Zero); }
      return true;
    },IntPtr.Zero);
  }
}
'@
# Scope Esc/WM_CANCELMODE to the test's hidden windows, never the user's active desktop.
[ArticleDragCancel]::Cancel($TargetProcessId)
