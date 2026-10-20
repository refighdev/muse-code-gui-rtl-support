# Muse Code GUI (unofficial, RTL)

Muse Code in a side panel for VS Code and Cursor: threads as tabs, approvals you can read, the files each thread changed, and full right-to-left support for Persian, Arabic and Hebrew. It uses your own `muse login`.

> Unofficial community project. Not made, endorsed or supported by Meta. "Muse" and "Muse Code" are Meta trademarks, used only to say what this works with.

## Use it

1. Install the `muse` CLI and sign in once: `curl -fsSL https://dev.meta.ai/install.sh | bash`, then `muse login`.
2. Open the Muse Code GUI icon in the activity bar, or run **Open Muse Code GUI** from the command palette (`Ctrl+Alt+M`).

The extension starts the app's local server on your editor's own Node runtime, bound to `127.0.0.1` only, and shows the UI in the side panel. It sends no telemetry and stores no credentials.

## Commands

Open Muse Code GUI, New Thread, Open Full Muse Code GUI in Editor, New Thread in This Folder, Open in Browser, Restart Server, Show Log.

Source and issues: https://github.com/refighdev/muse-code-gui-rtl-support
