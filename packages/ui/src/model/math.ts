/**
 * Gets markdown text ready for remark-math. Models write math as $x$, $$ blocks, \(x\) and \[ blocks; remark-math is
 * set to read only the double-dollar form, so a price like "$5 and $10" never opens a formula. This rewrites the
 * other forms into it and leaves code alone. A $$ block still being streamed (no closing line yet) is escaped, so
 * a half-written formula shows as plain text instead of a render error.
 */

/** $x$ in the usual typesetting sense: no space inside the dollars, and the closing one is not followed by a digit. */
const INLINE_DOLLAR = /(?<![\\$])\$(?![\s$])((?:[^$\\\n]|\\.)+?)(?<![\s\\])\$(?![\d$])/g;
const INLINE_PAREN = /\\\((.+?)\\\)/g;
const FENCE = /^[ \t>]*(`{3,}|~{3,})(.*)$/;
const INDENTED_CODE = /^(?: {4}|\t)/;

export interface PreparedMath {
  text: string;
  /** True when the text holds formulas worth loading the renderer for. */
  hasMath: boolean;
}

/** Rewrites the inline forms in one line of prose, skipping `code spans`. Returns the new line and whether it found math. */
function inline(line: string): { line: string; found: boolean } {
  let found = false;
  const swap = (_all: string, body: string) => {
    found = true;
    return `$$${body}$$`;
  };
  const parts = line.split(/(`+[^`]*`+)/);
  const out = parts.map((part, index) => {
    if (index % 2 === 1) {
      return part;
    }
    const done = part.replace(INLINE_PAREN, swap).replace(INLINE_DOLLAR, swap);
    found ||= /\$\$[^$]+\$\$/.test(done);
    return done;
  });
  return { line: out.join(""), found };
}

export function prepareMath(text: string): PreparedMath {
  if (!text.includes("$") && !text.includes("\\")) {
    return { text, hasMath: false };
  }
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let blockAt = -1;
  let hasMath = false;
  for (const raw of lines) {
    const fenced = FENCE.exec(raw);
    if (fence) {
      if (fenced && fenced[1]![0] === fence[0] && fenced[1]!.length >= fence.length && fenced[2]!.trim() === "") {
        fence = null;
      }
      out.push(raw);
      continue;
    }
    if (blockAt < 0 && fenced && !(fenced[1]![0] === "`" && fenced[2]!.includes("`"))) {
      fence = fenced[1]!;
      out.push(raw);
      continue;
    }
    const trimmed = raw.trim();
    if (blockAt >= 0) {
      // Inside a $$ block: only its closing matters.
      if (trimmed === "$$" || trimmed === "\\]") {
        out.push("$$");
        blockAt = -1;
        hasMath = true;
      } else if (trimmed.endsWith("$$") || trimmed.endsWith("\\]")) {
        // The closer sits at the end of a content line; give it a line of its own.
        out.push(trimmed.slice(0, -2).trimEnd(), "$$");
        blockAt = -1;
        hasMath = true;
      } else {
        out.push(raw);
      }
      continue;
    }
    if (trimmed === "\\[") {
      out.push("$$");
      blockAt = out.length - 1;
      continue;
    }
    const pad = /^\s*/.exec(raw)![0];
    if (/^\\\[.+\\\]$/.test(trimmed) && !trimmed.slice(2, -2).includes("\\]")) {
      out.push(`${pad}$$`, `${pad}${trimmed.slice(2, -2).trim()}`, `${pad}$$`);
      hasMath = true;
      continue;
    }
    if (/^\$\$.+\$\$$/.test(trimmed) && !trimmed.slice(2, -2).includes("$$")) {
      // A whole formula on one line is a display block.
      out.push(`${pad}$$`, `${pad}${trimmed.slice(2, -2).trim()}`, `${pad}$$`);
      hasMath = true;
      continue;
    }
    if (trimmed.startsWith("$$") && !trimmed.slice(2).includes("$$")) {
      out.push(trimmed === "$$" ? "$$" : raw);
      blockAt = out.length - 1;
      continue;
    }
    const swapped = inline(raw);
    hasMath ||= swapped.found;
    out.push(swapped.line);
  }
  if (blockAt >= 0) {
    // The block never closed: it is still arriving. Show its first line as plain text.
    out[blockAt] = out[blockAt]!.replace(/\$/g, "\\$");
  }
  return { text: out.join("\n"), hasMath };
}
