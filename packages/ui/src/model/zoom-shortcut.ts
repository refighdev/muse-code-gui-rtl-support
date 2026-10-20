export type ZoomStep = "in" | "out" | "reset";

/** Cmd/Ctrl zoom from a key event. Prefer `code` so WKWebView layouts that don't emit `+` still match. */
export function zoomStepFromKey(
  event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string; code: string },
  mac: boolean,
): ZoomStep | null {
  const mod = mac ? event.metaKey : event.ctrlKey;
  if (!mod || event.altKey || (mac ? event.ctrlKey : event.metaKey)) {
    return null;
  }
  const { code, key } = event;
  if (code === "Equal" || code === "NumpadAdd" || key === "=" || key === "+") {
    return "in";
  }
  if (code === "Minus" || code === "NumpadSubtract" || key === "-" || key === "_") {
    return "out";
  }
  if (!event.shiftKey && (code === "Digit0" || code === "Numpad0" || key === "0")) {
    return "reset";
  }
  return null;
}
