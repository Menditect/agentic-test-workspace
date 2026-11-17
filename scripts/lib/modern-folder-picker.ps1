param(
    [string]$Title = "Select Folder",
    [string]$InitialFolder = ""
)

$code = @'
using System;
using System.Runtime.InteropServices;

public class ModernFolderPicker {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("Shcore.dll")]
    public static extern int SetProcessDpiAwareness(int processDpiAwareness);

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem {
        void BindToHandler();
        void GetParent();
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    public static extern int SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc,
        ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    [ComImport]
    [Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int fdap);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(object pFilter);
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    public class FileOpenDialogRCW {}

    public static void EnableHighDpi() {
        IntPtr PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        IntPtr PER_MONITOR_AWARE = new IntPtr(-3);

        try {
            if (SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)) {
                try { SetThreadDpiAwarenessContext(PER_MONITOR_AWARE_V2); } catch {}
                return;
            }
        } catch {}

        try {
            if (SetProcessDpiAwarenessContext(PER_MONITOR_AWARE)) {
                try { SetThreadDpiAwarenessContext(PER_MONITOR_AWARE); } catch {}
                return;
            }
        } catch {}

        try {
            if (SetProcessDpiAwareness(2) == 0) {
                return;
            }
        } catch {}

        try {
            SetProcessDPIAware();
        } catch {}
    }

    public static string ShowDialog(string title, string initialFolder) {
        EnableHighDpi();
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialogRCW();
        uint options;
        dialog.GetOptions(out options);
        // FOS_PICKFOLDERS (0x20) | FOS_FORCEFILESYSTEM (0x40) | FOS_PATHMUSTEXIST (0x800)
        dialog.SetOptions(options | 0x00000020u | 0x00000040u | 0x00000800u);
        if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
        if (!string.IsNullOrEmpty(initialFolder) && System.IO.Directory.Exists(initialFolder)) {
            Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
            IShellItem item;
            if (SHCreateItemFromParsingName(initialFolder, IntPtr.Zero, ref iid, out item) == 0) {
                dialog.SetFolder(item);
            }
        }

        int hr = dialog.Show(IntPtr.Zero);
        if (hr == 0) {
            IShellItem item;
            dialog.GetResult(out item);
            if (item != null) {
                string path;
                item.GetDisplayName(0x80058000u, out path); // SIGDN_FILESYSPATH
                return path;
            }
        }
        return string.Empty;
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'ModernFolderPicker').Type) {
    try {
        Add-Type -TypeDefinition $code -Language CSharp
    } catch {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Application]::EnableVisualStyles()
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = $Title
        $dlg.ShowNewFolderButton = $true
        if ($InitialFolder -and (Test-Path $InitialFolder)) { $dlg.SelectedPath = $InitialFolder }
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $dlg.SelectedPath
        }
        exit 0
    }
}

try {
    [ModernFolderPicker]::EnableHighDpi()
    $path = [ModernFolderPicker]::ShowDialog($Title, $InitialFolder)
    if ($path) {
        Write-Output $path
    }
} catch {
    # Suppress runtime COM errors so second dialog never appears
}
