import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { prepareMath } from "../src/model/math.js";

describe("prepareMath", () => {
  it("turns inline math into the double-dollar form", () => {
    assert.deepEqual(prepareMath("Energy is $E = mc^2$ here."), { text: "Energy is $$E = mc^2$$ here.", hasMath: true });
    assert.equal(prepareMath("Use \\(x + 1\\) twice.").text, "Use $$x + 1$$ twice.");
    assert.equal(prepareMath("a $x$ and $y$ b").text, "a $$x$$ and $$y$$ b");
  });

  it("keeps display math as a block", () => {
    const block = "Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nAfter";
    assert.deepEqual(prepareMath(block), { text: block, hasMath: true });
    assert.equal(prepareMath("$$a^2 + b^2$$").text, "$$\na^2 + b^2\n$$");
    assert.equal(prepareMath("\\[\nx\n\\]").text, "$$\nx\n$$");
    assert.equal(prepareMath("\\[ y = 2 \\]").text, "$$\ny = 2\n$$");
  });

  it("leaves dollar amounts alone", () => {
    for (const text of ["It costs $5 and $10.", "Between $5 and $10 dollars", "$5,$10", "Pay $5.", "a $ b $ c", "Escaped \\$x\\$ stays"]) {
      assert.deepEqual(prepareMath(text), { text, hasMath: false }, text);
    }
  });

  it("does not touch code", () => {
    const fenced = "```sh\necho $x$ and $$\n```";
    assert.deepEqual(prepareMath(fenced), { text: fenced, hasMath: false });
    assert.equal(prepareMath("run `echo $x$` then $y$").text, "run `echo $x$` then $$y$$");
  });

  it("shows a block that is still arriving as plain text", () => {
    assert.deepEqual(prepareMath("Here:\n\n$$\n\\frac{a"), { text: "Here:\n\n\\$\\$\n\\frac{a", hasMath: false });
    assert.equal(prepareMath("Here:\n\n$$\n\\frac{a}{b}\n$$").hasMath, true);
    assert.equal(prepareMath("half $x").text, "half $x", "a lone dollar is just text");
  });

  it("handles nested fences, inline code fences and closers at the end of a line", () => {
    const nested = "- item\n\n    ```sh\n    echo $x$\n    ```";
    assert.deepEqual(prepareMath(nested), { text: nested, hasMath: false });
    assert.equal(prepareMath("```code``` and $y$").text, "```code``` and $$y$$");
    assert.deepEqual(prepareMath("$$\nx = 1 $$"), { text: "$$\nx = 1\n$$", hasMath: true });
  });

  it("does not merge two display formulas on one line, and keeps indentation", () => {
    const two = prepareMath("$$a$$ and $$b$$").text;
    assert.ok(!two.startsWith("$$\na$$"), two);
    assert.equal(prepareMath("  $$a$$").text, "  $$\n  a\n  $$");
  });
});

describe("math rendering", () => {
  const html = (text: string) =>
    renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        { remarkPlugins: [remarkGfm, [remarkMath, { singleDollarTextMath: false }]], rehypePlugins: [[rehypeKatex, { throwOnError: false, strict: "ignore" }]] },
        prepareMath(text).text,
      ),
    );

  it("typesets inline and block math and leaves prices as text", () => {
    assert.match(html("Energy $E = mc^2$."), /class="katex"/);
    const block = html("x\n\n$$\n\\frac{a}{b}\n$$\n\ny");
    assert.match(block, /katex-display/);
    const prices = html("It costs $5 and $10.");
    assert.doesNotMatch(prices, /katex/);
    assert.match(prices, /It costs \$5 and \$10\./);
  });

  it("does not throw on a block that is still arriving", () => {
    const partial = html("wait\n\n$$\n\\frac{a");
    assert.doesNotMatch(partial, /katex/);
    assert.match(partial, /\\frac\{a/);
  });
});
