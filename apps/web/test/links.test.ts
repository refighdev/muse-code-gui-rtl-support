import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { externalHref } from "../src/links.js";

describe("desktop links", () => {
  const origin = "http://127.0.0.1:52314";
  it("sends outside web and mail links to the browser", () => {
    assert.equal(externalHref("https://github.com/o/r/pull/90", origin), "https://github.com/o/r/pull/90");
    assert.equal(externalHref("mailto:hi@example.com", origin), "mailto:hi@example.com");
  });
  it("keeps Muse Code GUI's own pages and file links in the app", () => {
    assert.equal(externalHref("/threads/abc", origin), null);
    assert.equal(externalHref("src/app.ts#L3", origin), null);
    assert.equal(externalHref("http://127.0.0.1:52314/api/files/raw", origin), null);
    assert.equal(externalHref("javascript:alert(1)", origin), null);
  });
});
