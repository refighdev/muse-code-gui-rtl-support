import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Logo } from "../src/components/ui/primitives.js";

describe("Logo", () => {
  it("renders the current Muse Code GUI mark, not the retired H-and-dot", () => {
    const markup = renderToStaticMarkup(createElement(Logo, { size: 32 }));
    assert.match(markup, /M 619\.9 322/, "new mark path missing");
    assert.doesNotMatch(markup, /M9\.5 9v14/, "retired H strokes present");
    assert.doesNotMatch(markup, /<circle/, "retired blue dot present");
  });
});
