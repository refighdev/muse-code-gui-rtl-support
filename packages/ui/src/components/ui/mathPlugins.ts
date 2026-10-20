// Loaded on demand, the first time a message holds a formula, so KaTeX stays out of the main bundle.
import type { Options } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/** Only $$..$$ opens a formula: prepareMath rewrites the other forms into it, so "$5 and $10" is left alone. */
export const MATH_REMARK: NonNullable<Options["remarkPlugins"]> = [[remarkMath, { singleDollarTextMath: false }]];
export const MATH_REHYPE: NonNullable<Options["rehypePlugins"]> = [[rehypeKatex, { throwOnError: false, strict: "ignore", output: "html" }]];
