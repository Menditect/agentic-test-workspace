param(
    [string]$Title = "Select Folder",
    [string]$InitialFolder = "",
    [switch]$ServerMode
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class ModernFolderPicker {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

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

    private static bool _dpiInitialized = false;
    private static Form _reusableOwner = null;

    public static void EnableHighDpi() {
        if (_dpiInitialized) return;
        _dpiInitialized = true;
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

    private static Form GetOrCreateOwnerForm() {
        if (_reusableOwner == null || _reusableOwner.IsDisposed) {
            _reusableOwner = new Form();
            _reusableOwner.TopMost = true;
            _reusableOwner.ShowInTaskbar = false;
            _reusableOwner.FormBorderStyle = FormBorderStyle.None;
            _reusableOwner.StartPosition = FormStartPosition.Manual;
            _reusableOwner.Location = new Point(-32000, -32000);
            _reusableOwner.Size = new Size(1, 1);
            _reusableOwner.Opacity = 0;
            _reusableOwner.Show();
        }
        return _reusableOwner;
    }

    public static void WarmUp() {
        EnableHighDpi();
        try {
            Application.EnableVisualStyles();
        } catch {}
        try {
            Form owner = GetOrCreateOwnerForm();
            IntPtr h = owner.Handle;
        } catch {}
        try {
            // Pre-load ExplorerFrame.dll and shell COM interfaces in STA thread before user clicks Browse
            IFileOpenDialog warmDialog = (IFileOpenDialog)new FileOpenDialogRCW();
            uint opts;
            warmDialog.GetOptions(out opts);
            warmDialog.SetOptions(opts | 0x00000020u | 0x00000040u | 0x00000800u | 0x00000008u | 0x00100000u | 0x02000000u);
            Marshal.FinalReleaseComObject(warmDialog);
        } catch {}
    }

    public static string ShowDialog(string title, string initialFolder, IntPtr ownerHwnd) {
        EnableHighDpi();
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialogRCW();
        try {
            uint options;
            dialog.GetOptions(out options);
            // FOS_PICKFOLDERS (0x20) | FOS_FORCEFILESYSTEM (0x40) | FOS_PATHMUSTEXIST (0x800)
            // | FOS_NOCHANGEDIR (0x08) | FOS_NODEREFERENCELINKS (0x00100000) | FOS_DONTADDTORECENT (0x02000000)
            dialog.SetOptions(options | 0x00000020u | 0x00000040u | 0x00000800u | 0x00000008u | 0x00100000u | 0x02000000u);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
            if (!string.IsNullOrEmpty(initialFolder) && Directory.Exists(initialFolder)) {
                Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                IShellItem folderItem;
                if (SHCreateItemFromParsingName(initialFolder, IntPtr.Zero, ref iid, out folderItem) == 0 && folderItem != null) {
                    try {
                        dialog.SetDefaultFolder(folderItem);
                        dialog.SetFolder(folderItem);
                    } finally {
                        Marshal.ReleaseComObject(folderItem);
                    }
                }
            }

            IntPtr parentHwnd = ownerHwnd;
            if (parentHwnd == IntPtr.Zero) {
                try {
                    Form owner = GetOrCreateOwnerForm();
                    owner.Activate();
                    parentHwnd = owner.Handle;
                } catch {
                    parentHwnd = GetForegroundWindow();
                }
            }
            if (parentHwnd != IntPtr.Zero) {
                try { SetForegroundWindow(parentHwnd); } catch {}
            }

            int hr = dialog.Show(parentHwnd);
            if (hr == 0) {
                IShellItem resultItem;
                dialog.GetResult(out resultItem);
                if (resultItem != null) {
                    try {
                        string path;
                        resultItem.GetDisplayName(0x80058000u, out path); // SIGDN_FILESYSPATH
                        return path ?? string.Empty;
                    } finally {
                        Marshal.ReleaseComObject(resultItem);
                    }
                }
            }
            return string.Empty;
        } finally {
            try { Marshal.FinalReleaseComObject(dialog); } catch {}
        }
    }

    public static string ShowDialog(string title, string initialFolder) {
        return ShowDialog(title, initialFolder, IntPtr.Zero);
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'ModernFolderPicker').Type) {
    $cacheDll = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "MenditectModernFolderPicker_v3.dll")
    $loadedFromCache = $false
    if ([System.IO.File]::Exists($cacheDll)) {
        try {
            [System.Reflection.Assembly]::LoadFrom($cacheDll) | Out-Null
            $loadedFromCache = $true
        } catch {}
    }
    if (-not $loadedFromCache) {
        try {
            Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies "System.Windows.Forms","System.Drawing" -OutputAssembly $cacheDll -PassThru | Out-Null
        } catch {
            try {
                Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies "System.Windows.Forms","System.Drawing" | Out-Null
            } catch {}
        }
    }
}

function Invoke-FolderPickerDialog([string]$DlgTitle, [string]$DlgInitialFolder) {
    if (([System.Management.Automation.PSTypeName]'ModernFolderPicker').Type) {
        return [ModernFolderPicker]::ShowDialog($DlgTitle, $DlgInitialFolder)
    } else {
        $owner = New-Object System.Windows.Forms.Form
        $owner.TopMost = $true
        $owner.ShowInTaskbar = $false
        $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
        $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
        $owner.Location = New-Object System.Drawing.Point(-32000, -32000)
        $owner.Size = New-Object System.Drawing.Size(1, 1)
        $owner.Opacity = 0
        try {
            $owner.Show()
            $owner.Activate()
            $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
            $dlg.Description = $DlgTitle
            $dlg.ShowNewFolderButton = $true
            if ($DlgInitialFolder -and [System.IO.Directory]::Exists($DlgInitialFolder)) {
                $dlg.SelectedPath = $DlgInitialFolder
            }
            if ($dlg.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
                return $dlg.SelectedPath
            }
            return ""
        } finally {
            try {
                $owner.Close()
                $owner.Dispose()
            } catch {}
        }
    }
}

if (([System.Management.Automation.PSTypeName]'ModernFolderPicker').Type) {
    [ModernFolderPicker]::WarmUp()
} else {
    [System.Windows.Forms.Application]::EnableVisualStyles()
}

if ($ServerMode) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding = [System.Text.Encoding]::UTF8
    [Console]::Out.WriteLine('{"ready":true}')
    [Console]::Out.Flush()

    while ($null -ne ($line = [Console]::In.ReadLine())) {
        $trimmed = $line.Trim()
        if (-not $trimmed) { continue }
        $reqTitle = "Select Folder"
        $reqInit = ""
        if ($trimmed.StartsWith("REQ`t")) {
            $parts = $trimmed.Split("`t")
            if ($parts.Length -ge 2 -and $parts[1]) { $reqTitle = $parts[1] }
            if ($parts.Length -ge 3 -and $parts[2]) { $reqInit = $parts[2] }
        } else {
            try {
                $req = $trimmed | ConvertFrom-Json
                if ($req.title) { $reqTitle = [string]$req.title }
                if ($req.initialFolder) { $reqInit = [string]$req.initialFolder }
            } catch {}
        }

        $selected = ""
        try {
            $selected = Invoke-FolderPickerDialog -DlgTitle $reqTitle -DlgInitialFolder $reqInit
        } catch {}

        $escapedPath = ""
        if ($selected) {
            $escapedPath = ([string]$selected).Replace('\', '\\').Replace('"', '\"')
        }
        $cancelledStr = if ($selected) { "false" } else { "true" }
        [Console]::Out.WriteLine("{`"ok`":true,`"cancelled`":$cancelledStr,`"folderPath`":`"$escapedPath`"}")
        [Console]::Out.Flush()
    }
    exit 0
}

try {
    $path = Invoke-FolderPickerDialog -DlgTitle $Title -DlgInitialFolder $InitialFolder
    if ($path) {
        [Console]::Out.WriteLine($path)
    }
} catch {
    # Suppress runtime COM errors so second dialog never appears
}
