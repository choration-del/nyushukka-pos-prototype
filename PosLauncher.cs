using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Reflection;

[assembly: AssemblyTitle("Nyushukka POS Launcher")]
[assembly: AssemblyVersion("0.2.2.0")]
internal static class PosLauncher
{
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.Title = "POSレジ試作 - 終了はCtrl+C";
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        try
        {
            string node = Path.Combine(folder, "runtime", "node.exe");
            string script = Path.Combine(folder, "launcher.js");
            if (!File.Exists(node) || !File.Exists(script))
                throw new FileNotFoundException("必要なファイルがありません。ZIPを「すべて展開」し、runtimeフォルダーも一緒に置いてください。");
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = node;
            info.Arguments = "\"" + script + "\"";
            if (Array.IndexOf(args, "--no-browser") >= 0) info.Arguments += " --no-browser";
            info.WorkingDirectory = folder;
            // Run the executable directly. Neither .cmd nor .bat file associations are used.
            info.UseShellExecute = false;
            info.CreateNoWindow = false;
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                int code = process.ExitCode;
                if (code != 0) Pause();
                return code;
            }
        }
        catch (Exception error)
        {
            string message = "起動できませんでした。\n" + error.Message + "\n\nデータは削除・初期化していません。";
            Console.Error.WriteLine(message);
            try { File.WriteAllText(Path.Combine(folder, "startup-error.txt"), DateTime.UtcNow.ToString("o") + "\n" + error.ToString(), new UTF8Encoding(false)); } catch { }
            Pause();
            return 1;
        }
    }
    private static void Pause()
    {
        if (Environment.GetEnvironmentVariable("POS_NONINTERACTIVE") == "1" || Console.IsInputRedirected) return;
        Console.WriteLine("この内容を確認したら、何かキーを押して閉じてください。");
        Console.ReadKey(true);
    }
}
