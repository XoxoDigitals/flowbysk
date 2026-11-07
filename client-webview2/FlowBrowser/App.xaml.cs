using System.Windows;

namespace FlowBrowser;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        SecurityGuard.InitializeAndEnforce();
        base.OnStartup(e);
    }
}
