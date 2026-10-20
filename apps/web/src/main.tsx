import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MuseGuiApp, type MuseGuiClient } from "@musegui/ui";
import { Connect } from "./Connect.js";
import { desktopFrame, titlebarOverlay, bindDesktopZoom } from "./frame.js";
import { bindDesktopLinks } from "./links.js";
import { appNotifier } from "./notifier.js";
import { desktopUpdater } from "./updater.js";
import { WebMuseGuiClient } from "./webClient.js";
import "./theme.css";

bindDesktopZoom();
bindDesktopLinks();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Muse Code GUI: missing #root element.");
}

/**
 * `?view=panel&cwd=<folder>&theme=<light|dark>` asks for the compact layout an editor extension shows
 * in its side panel: one folder, threads as tabs. `host=editor` hands file links to the editor.
 * Read once, at load.
 */
function hostOptions(): { panel?: { cwd: string | null }; hostTheme?: "light" | "dark"; editorHost?: boolean } {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  return {
    ...(params.get("view") === "panel" ? { panel: { cwd: params.get("cwd") || null } } : {}),
    ...(theme === "light" || theme === "dark" ? { hostTheme: theme } : {}),
    ...(params.get("host") === "editor" ? { editorHost: true } : {}),
  };
}

const host = hostOptions();

/**
 * `#/connect` picks the daemon this page talks to. It is read before the app mounts, because the
 * client reads its address once at module load and every open stream belongs to that address.
 */
function Root({ makeClient }: { makeClient: () => MuseGuiClient }) {
  const [connecting, setConnecting] = useState(window.location.hash === "#/connect");
  if (connecting) {
    return (
      <Connect
        onDone={() => {
          setConnecting(false);
          // A reload, not a re-render: the client keeps its address and its stream from load time.
          window.location.replace(window.location.pathname);
        }}
      />
    );
  }
  return (
    <MuseGuiApp
      client={makeClient()}
      frame={desktopFrame()}
      titlebarOverlay={titlebarOverlay()}
      updater={desktopUpdater()}
      notifier={appNotifier()}
      {...host}
    />
  );
}

/**
 * `npm run dev:demo` swaps the server for an in-memory client with sample projects and threads, so
 * the UI can be worked on without muse. The flag is fixed at build time, so release builds drop it.
 */
async function clientFactory(): Promise<{ makeClient: () => MuseGuiClient; banner: ReactNode }> {
  if (import.meta.env.MODE === "demo") {
    const { DemoClient } = await import("./demo/client.js");
    return { makeClient: () => new DemoClient(), banner: null };
  }
  return { makeClient: () => new WebMuseGuiClient(), banner: null };
}

void clientFactory().then(({ makeClient, banner }) =>
  createRoot(root).render(
    <StrictMode>
      {banner ? (
        <div className="flex h-full flex-col">
          {banner}
          <div className="min-h-0 flex-1">
            <Root makeClient={makeClient} />
          </div>
        </div>
      ) : (
        <Root makeClient={makeClient} />
      )}
    </StrictMode>,
  ),
);
