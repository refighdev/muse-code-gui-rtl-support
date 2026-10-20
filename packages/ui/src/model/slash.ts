import type { ApprovalMode, ModelOption, ReasoningEffort, SkillEntry } from "../types.js";

/** What a built-in command does; skills are the other kind of command. */
export type SlashAction = "compact" | "model" | "effort" | "permissions" | "fork" | "side" | "new" | "resume" | "init" | "skill" | "goal";

export interface SlashCommand {
  /** Typed after the slash. */
  name: string;
  aliases: string[];
  /** The arguments it takes, like `[level]`; null when it takes none. */
  hint: string | null;
  description: string;
  kind: "action" | "skill";
  action: SlashAction | null;
  skill: SkillEntry | null;
  /** Only works inside a thread, like compacting or forking it. */
  needsThread: boolean;
  /** Picking it from the menu runs it at once; otherwise the menu fills in `/name ` for arguments. */
  runsBare: boolean;
}

function builtin(
  name: string,
  action: SlashAction,
  description: string,
  options: { aliases?: string[]; hint?: string; needsThread?: boolean; runsBare?: boolean } = {},
): SlashCommand {
  return {
    name,
    aliases: options.aliases ?? [],
    hint: options.hint ?? null,
    description,
    kind: "action",
    action,
    skill: null,
    needsThread: options.needsThread ?? false,
    runsBare: options.runsBare ?? true,
  };
}

/** The Muse terminal commands that map onto the session protocol, in its wording where it has one. */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  builtin("compact", "compact", "Summarize the conversation to free up context", { needsThread: true }),
  builtin("model", "model", "Choose the model", { aliases: ["models"], hint: "[model]" }),
  builtin("effort", "effort", "Set how long the model thinks: off, low, medium, high, xhigh, max or auto", { hint: "[level]" }),
  builtin("permissions", "permissions", "Choose what Muse can do without asking: ask, unlisted, deny or full", { hint: "[mode]" }),
  builtin("fork", "fork", "Branch this thread into a new one", { needsThread: true }),
  builtin("side", "side", "Open a side chat next to this thread, without adding to it", { hint: "[message]", needsThread: true }),
  builtin("new", "new", "Start a new thread in this project", { aliases: ["clear"] }),
  builtin("resume", "resume", "Open an earlier thread"),
  builtin("init", "init", "Explore the workspace and create or improve AGENTS.md"),
  builtin("goal", "goal", "Set a goal Muse keeps working toward across turns, or pause, resume or clear it", {
    hint: "<objective> | pause | resume | clear",
    runsBare: false,
  }),
  builtin("skill", "skill", "Run a skill by name", { hint: "<skill> [request]", runsBare: false }),
];

/** Sent for `/init`; the terminal UI's own prompt is not published, so this asks for the same outcome. */
export const INIT_PROMPT =
  "Explore this workspace and create or improve its AGENTS.md: what the project is, how to build, run and test it, how the code is organized, and the conventions a coding agent should follow here.";

/** The terminal UI's preamble for a skill the user invoked by hand, followed by the skill's body. */
export const SKILL_PREAMBLE =
  "Muse Code loaded the full instructions for an explicitly invoked skill. Apply these instructions only to the current user turn.";

/** The `/name` a skill answers to: plugin skills are named `plugin:<plugin>:<skill>`, so the last part. */
export function shortName(skill: SkillEntry): string {
  return (skill.name.split(":").pop() || skill.name).toLowerCase();
}

/** One line for menus: skill descriptions are written for the model and run long. */
export function skillSummary(skill: SkillEntry): string {
  if (skill.shortDescription) {
    return skill.shortDescription;
  }
  const text = skill.description.trim();
  const end = text.search(/[.!?](\s|$)/);
  return end > 0 ? text.slice(0, end + 1) : text;
}

/** Built-ins first; each skill also gets a `/name` shortcut unless a built-in or earlier skill has that name. */
export function slashCommands(skills: readonly SkillEntry[], options: { inThread: boolean }): SlashCommand[] {
  const taken = new Set<string>();
  const commands: SlashCommand[] = [];
  for (const command of BUILTIN_COMMANDS) {
    for (const name of [command.name, ...command.aliases]) {
      taken.add(name);
    }
    if (options.inThread || !command.needsThread) {
      commands.push(command);
    }
  }
  for (const skill of skills) {
    const name = shortName(skill);
    if (taken.has(name)) {
      continue;
    }
    taken.add(name);
    commands.push({
      name,
      aliases: [],
      hint: skill.argumentHint ? skill.argumentHint : "[request]",
      description: skillSummary(skill),
      kind: "skill",
      action: null,
      skill,
      needsThread: false,
      runsBare: false,
    });
  }
  return commands;
}

export interface ParsedSlash {
  name: string;
  args: string;
}

/** `/name args` at the very start of a message. A path like `/usr/bin` is not a command. */
export function parseSlash(text: string): ParsedSlash | null {
  const match = /^\/([A-Za-z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  return { name: (match[1] as string).toLowerCase(), args: (match[2] ?? "").trim() };
}

export type ResolvedSlash =
  | { kind: "action"; command: SlashCommand; args: string }
  | { kind: "skill"; skill: SkillEntry; args: string }
  | { kind: "unknown"; name: string };

/** Finds what a typed command means. `/skill <name> …` reaches every skill, shortcut or not. */
export function resolveSlash(parsed: ParsedSlash, commands: readonly SlashCommand[], skills: readonly SkillEntry[]): ResolvedSlash {
  const command = commands.find((c) => c.name === parsed.name || c.aliases.includes(parsed.name));
  if (!command) {
    return { kind: "unknown", name: parsed.name };
  }
  if (command.kind === "skill" && command.skill) {
    return { kind: "skill", skill: command.skill, args: parsed.args };
  }
  if (command.action === "skill") {
    const [first = "", ...rest] = parsed.args.split(/\s+/);
    const wanted = first.replace(/^\//, "").toLowerCase();
    const skill = wanted
      ? (skills.find((s) => s.id.toLowerCase() === wanted) ??
        skills.find((s) => s.name.toLowerCase() === wanted) ??
        skills.find((s) => shortName(s) === wanted))
      : undefined;
    return skill ? { kind: "skill", skill, args: rest.join(" ").trim() } : { kind: "unknown", name: wanted ? `skill ${wanted}` : "skill" };
  }
  return { kind: "action", command, args: parsed.args };
}

/** Lower is better; null means no match. */
function rank(command: SlashCommand, query: string): number | null {
  if (!query) {
    return 0;
  }
  const names = [command.name, ...command.aliases];
  if (names.includes(query)) {
    return 0;
  }
  if (command.name.startsWith(query)) {
    return 1;
  }
  if (command.aliases.some((alias) => alias.startsWith(query))) {
    return 2;
  }
  if (command.name.includes(query)) {
    return 3;
  }
  let at = 0;
  for (const char of command.name) {
    if (char === query[at]) {
      at += 1;
      if (at === query.length) {
        return 4;
      }
    }
  }
  if (query.length >= 3 && command.description.toLowerCase().includes(query)) {
    return 5;
  }
  return null;
}

/**
 * Commands matching what follows the slash, kept in two runs (built-ins, skills) so the menu can group them.
 * The run holding the best match comes first, so `/thr` puts a skill named threejs above a built-in
 * that only mentions threads.
 */
export function matchSlash(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const wanted = query.toLowerCase();
  const runs: Record<SlashCommand["kind"], { command: SlashCommand; score: number; order: number }[]> = { action: [], skill: [] };
  commands.forEach((command, order) => {
    const score = rank(command, wanted);
    if (score !== null) {
      runs[command.kind].push({ command, score, order });
    }
  });
  for (const run of Object.values(runs)) {
    run.sort((a, b) => a.score - b.score || a.order - b.order);
  }
  const best = (kind: SlashCommand["kind"]) => runs[kind][0]?.score ?? Number.POSITIVE_INFINITY;
  const order: SlashCommand["kind"][] = best("skill") < best("action") ? ["skill", "action"] : ["action", "skill"];
  return order.flatMap((kind) => runs[kind].map((entry) => entry.command));
}

/** The turn a skill invocation sends: the model gets instructions, the transcript shows what was typed. */
export function skillTurn(skill: SkillEntry, args: string, typed: string, body: string | null): { text: string; displayText: string } {
  const request = args.trim();
  if (body !== null) {
    const text = [SKILL_PREAMBLE, `<skill-body id="${skill.id}">\n${body.trim()}\n</skill-body>`, request || "Apply the skill to the conversation so far."].join("\n\n");
    return { text, displayText: typed };
  }
  return {
    text: `Use skill ${skill.id}: call read_skill with name "${skill.id}" first, then apply it to: ${request || "the conversation so far"}`,
    displayText: typed,
  };
}

const EFFORT_WORDS: Record<string, ReasoningEffort | null> = {
  auto: null,
  off: "none",
  none: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  "extra high": "xhigh",
  "extra-high": "xhigh",
  max: "max",
  // Muse sends "ultra" to the model as "max", so the word still works and means the same.
  ultra: "max",
};

/** `undefined` when the word is not an effort level; `null` means Auto. */
export function parseEffort(word: string): ReasoningEffort | null | undefined {
  const key = word.trim().toLowerCase();
  return key in EFFORT_WORDS ? EFFORT_WORDS[key] : undefined;
}

const MODE_WORDS: Record<string, ApprovalMode> = {
  ask: "onRequest",
  "ask first": "onRequest",
  onrequest: "onRequest",
  unlisted: "promptUnmatched",
  "ask for unlisted": "promptUnmatched",
  promptunmatched: "promptUnmatched",
  deny: "denyUnmatched",
  "deny unlisted": "denyUnmatched",
  denyunmatched: "denyUnmatched",
  full: "allowAll",
  "full access": "allowAll",
  allowall: "allowAll",
};

export function parseMode(word: string): ApprovalMode | undefined {
  return MODE_WORDS[word.trim().toLowerCase()];
}

/** A model by id or display label, exact before prefix. */
export function findModel(models: readonly ModelOption[], word: string, label: (id: string) => string): ModelOption | undefined {
  const wanted = word.trim().toLowerCase();
  if (!wanted) {
    return undefined;
  }
  const names = (m: ModelOption) => [m.modelId.toLowerCase(), m.displayLabel.toLowerCase(), label(m.modelId).toLowerCase()];
  return models.find((m) => names(m).includes(wanted)) ?? models.find((m) => names(m).some((n) => n.startsWith(wanted)));
}
