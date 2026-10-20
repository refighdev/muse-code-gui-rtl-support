import { createContext, useContext } from "react";

/**
 * The compact layout for narrow hosts like an editor's side panel: one folder, no project sidebar,
 * open threads as tabs across the top. `cwd` is the folder the host has open.
 */
export interface PanelMode {
  cwd: string | null;
}

export const PanelContext = createContext<PanelMode | null>(null);

/** The panel mode, or null in the full app. */
export function usePanel(): PanelMode | null {
  return useContext(PanelContext);
}

/** Whether a thread's folder is the panel's folder or inside it. */
export function inFolder(path: string, folder: string | null): boolean {
  if (!folder) {
    return true;
  }
  if (path === folder) {
    return true;
  }
  const sep = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  const base = folder.endsWith(sep) ? folder : folder + sep;
  return path.startsWith(base);
}
