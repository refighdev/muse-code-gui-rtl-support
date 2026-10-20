# Muse Code GUI

A desktop and web interface for Meta's **Muse Code CLI** (`muse`), with first-class **right-to-left** support for Persian, Arabic and Hebrew.

> Unofficial community project. Not made, endorsed or supported by Meta. "Muse" and "Muse Code" are Meta trademarks, used only to say what this app works with.

<div dir="rtl">

یک رابط گرافیکی دسکتاپ و وب برای Muse Code CLI با پشتیبانی کامل از **راست‌به‌چپ** (فارسی، عربی، عبری). هر پیام، لیست، عنوان، جدول و کادر نوشتن جهت خودش را از متن خودش می‌گیرد؛ فارسی راست‌چین و انگلیسی چپ‌چین می‌ماند و کد همیشه چپ‌به‌راست است.

</div>

## Features

- **RTL done properly** - direction is decided per block (`dir="auto"`), so mixed Persian/English text, lists, quotes and tables lay out correctly. Code blocks always stay left-to-right.
- **Projects and threads** grouped by working directory; resume any session, including ones started from the `muse` terminal UI.
- **Readable approvals and inline diffs** where the edit happened; approvals are never bypassed.
- **File viewer** beside the thread: highlighted source, Markdown preview, images, video and PDF.
- **Plan meter, goals, background tool control** and reasoning effort (`none` ... `max`) that sticks for the session.
- **No telemetry.** Nothing about you or your install leaves your machine. The only automatic request is the update check against this repository's GitHub Releases.
- **Your own login.** It uses the existing `muse login` session and never stores credentials.

## Install

You need the `muse` CLI, signed in once:

```bash
curl -fsSL https://dev.meta.ai/install.sh | bash
muse login
```

**Linux (AppImage):** download `MuseCodeGUI_*_amd64.AppImage` from the [latest release](../../releases/latest), then

```bash
chmod +x MuseCodeGUI_*_amd64.AppImage && ./MuseCodeGUI_*_amd64.AppImage
```

Some distributions need `libfuse2`. The app bundles its own Node.js.

**Arch Linux:** build the package from the AppImage with the `PKGBUILD` in [`packaging/arch`](packaging/arch) (`makepkg -si`).

## Develop

Requires Node 22+ and the `muse` CLI.

```bash
npm install
npm run build --workspace @musegui/daemon --workspace @musegui/ui --workspace @musegui/server
npm run build --workspace @musegui/web
npm run serve --workspace @musegui/web      # web app on http://127.0.0.1:3127
```

No `muse` on the machine? `npm run dev:demo --workspace @musegui/web` runs the UI against sample data.

Desktop app (Tauri 2, needs Rust and the WebKitGTK dev packages):

```bash
npm run dev --workspace musegui-desktop
```

## Architecture

```
packages/ui      shared React UI (desktop + web)
packages/daemon  Node service: spawns `muse serve` per workspace, speaks MSP over stdio
packages/server  local HTTP/SSE server around the daemon
apps/desktop     Tauri 2 shell wrapping the UI
apps/web         the same UI in a browser
```

It talks to Muse Code through the official [`@muse-code/sdk`](https://github.com/meta-models/muse-code-sdk) (Muse Session Protocol); no terminal scraping. State is kept in a local SQLite file.

## Known limitation

Each running app starts its own `muse serve` processes, and a live turn streams only to the process that started it. Keep one window open per project to watch a task live.

## License

MIT, see [LICENSE](LICENSE).
