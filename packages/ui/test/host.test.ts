import { test } from "node:test";
import assert from "node:assert/strict";
import { fromHost, hostStylesheet, isTranslucent, resolveHostOrigin, safeCssValue, sanitizeHostVars } from "../src/app/host.js";

test("hostStylesheet maps editor colors onto Muse Code GUI's tokens", () => {
  const css = hostStylesheet({
    surface: "#181818",
    foreground: "#cccccc",
    "descriptionForeground": "#9d9d9d",
    "list-hoverBackground": "#2a2d2e",
    "button-background": "#0078d4",
    "font-family": "-apple-system, sans-serif",
    "font-size": "13px",
  });
  assert.match(css, /--bg: #181818 !important;/);
  assert.match(css, /--fg: #cccccc !important;/);
  assert.match(css, /--fg-muted: #9d9d9d !important;/);
  assert.match(css, /--bg-hover: #2a2d2e !important;/);
  assert.match(css, /--accent: #0078d4 !important;/);
  assert.match(css, /--font-sans: -apple-system, sans-serif !important;/);
  // text-sm is 0.875rem, so a 13px editor font puts the root at 13 / 0.875.
  assert.match(css, /font-size: 14\.86px !important;/);
});

test("hostStylesheet falls back through sources and ignores blanks", () => {
  assert.match(hostStylesheet({ "sideBar-foreground": " ", foreground: "#eee" }), /--fg: #eee/);
  assert.equal(hostStylesheet({}), "");
  assert.doesNotMatch(hostStylesheet({ "font-size": "abc", surface: "#000" }), /font-size/);
});

test("hostStylesheet never takes a see-through color for surfaces things float over", () => {
  const css = hostStylesheet({ "editorHoverWidget-background": "#ffffff0d", "editorWidget-background": "#202020" });
  assert.match(css, /--bg-raised: #202020 !important;/);
  assert.equal(isTranslucent("#ffffff0d"), true);
  assert.equal(isTranslucent("#fff8"), true);
  assert.equal(isTranslucent("#202020"), false);
  assert.equal(isTranslucent("#202020ff"), false);
  assert.equal(isTranslucent("rgba(0, 0, 0, 0.4)"), true);
  assert.equal(isTranslucent("rgb(0 0 0 / 50%)"), true);
  assert.equal(isTranslucent("rgb(10, 10, 10)"), false);
});

test("resolveHostOrigin takes the nearest ancestor, then the referrer, else nothing", () => {
  assert.equal(resolveHostOrigin(["vscode-webview://abc", "vscode-file://vscode-app"], ""), "vscode-webview://abc");
  assert.equal(resolveHostOrigin(undefined, "https://host.example/page?x=1"), "https://host.example");
  assert.equal(resolveHostOrigin([], "not a url"), null);
  assert.equal(resolveHostOrigin(["null"], ""), null);
  assert.equal(resolveHostOrigin(undefined, ""), null);
});

test("fromHost accepts only the parent window at the expected origin", () => {
  const parent = {};
  const origin = "vscode-webview://abc";
  assert.equal(fromHost({ source: parent, origin }, parent, origin), true);
  assert.equal(fromHost({ source: parent, origin: "https://evil.example" }, parent, origin), false);
  assert.equal(fromHost({ source: {}, origin }, parent, origin), false);
  // With no known host origin nothing is trusted.
  assert.equal(fromHost({ source: parent, origin }, parent, null), false);
  assert.equal(fromHost({ source: parent, origin: "null" }, parent, null), false);
});

test("safeCssValue rejects anything that could inject CSS", () => {
  for (const bad of [
    "red; background: url(https://evil.example/x)",
    "url(javascript:alert(1))",
    "URL( 'x' )",
    "expression(alert(1))",
    "red } body { display: none",
    "red;",
    "</style><script>x</script>",
    "red /* c */",
    "u\\72l(x)",
    "red !important",
    "@import 'x'",
    "image-set('x' 1x)",
    "x".repeat(301),
    "",
    "   ",
  ]) {
    assert.equal(safeCssValue(bad), null, bad);
  }
  assert.equal(safeCssValue(123), null);
  assert.equal(safeCssValue(" #1e1e1e "), "#1e1e1e");
  assert.equal(safeCssValue("rgba(0, 0, 0, 0.4)"), "rgba(0, 0, 0, 0.4)");
  assert.equal(safeCssValue("\"Segoe WPC\", -apple-system, sans-serif"), "\"Segoe WPC\", -apple-system, sans-serif");
});

test("sanitizeHostVars keeps plain names and values only", () => {
  const clean = sanitizeHostVars({
    foreground: "#ccc",
    "bad name": "#fff",
    "x}y": "#fff",
    surface: "url(https://evil.example)",
  });
  assert.deepEqual(clean, { foreground: "#ccc" });
  assert.deepEqual(sanitizeHostVars(null), {});
  assert.deepEqual(sanitizeHostVars("str"), {});
});

test("hostStylesheet never emits an injected value or name", () => {
  const css = hostStylesheet({
    surface: "#111",
    foreground: "red; background: url(//evil.example/a)",
    "descriptionForeground": "red } html { display: none",
    "font-family": "x; } body { display:none",
    "--evil": "1",
  });
  assert.match(css, /--bg: #111 !important;/);
  assert.doesNotMatch(css, /evil|url\(|display|--fg/);
  assert.equal((css.match(/\{/g) ?? []).length, 1);
  assert.equal((css.match(/\}/g) ?? []).length, 1);
});
