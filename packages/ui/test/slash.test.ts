import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findModel,
  matchSlash,
  parseEffort,
  parseMode,
  parseSlash,
  resolveSlash,
  skillSummary,
  skillTurn,
  slashCommands,
  SKILL_PREAMBLE,
} from "../src/model/slash.js";
import type { ModelOption, SkillEntry } from "../src/types.js";

function skill(name: string, overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: `bundled:${name}`,
    name,
    displayName: name,
    description: `Does ${name} things. Use ONLY when asked.`,
    shortDescription: null,
    scope: "bundled",
    activation: "on",
    ...overrides,
  };
}

const SKILLS = [skill("plan"), skill("git"), skill("taste"), skill("compact"), skill("threejs", { id: "plugin:threejs:threejs", scope: "plugin" })];

describe("slash commands", () => {
  it("parses a leading command and its arguments, and leaves paths and bare slashes alone", () => {
    assert.deepEqual(parseSlash("/Plan  tidy the API\nand tests"), { name: "plan", args: "tidy the API\nand tests" });
    assert.deepEqual(parseSlash("  /compact "), { name: "compact", args: "" });
    assert.deepEqual(parseSlash("/plugin:threejs:threejs scene"), { name: "plugin:threejs:threejs", args: "scene" });
    assert.equal(parseSlash("/usr/bin/node crashes"), null);
    assert.equal(parseSlash("/"), null);
    assert.equal(parseSlash("fix /compact"), null);
  });

  it("lists built-ins, then a shortcut per skill, skipping names already taken", () => {
    const inThread = slashCommands(SKILLS, { inThread: true }).map((c) => c.name);
    assert.deepEqual(inThread.slice(0, 3), ["compact", "model", "effort"]);
    assert.ok(inThread.includes("plan") && inThread.includes("threejs"));
    assert.equal(inThread.filter((n) => n === "compact").length, 1, "the built-in wins over a skill of the same name");
    const home = slashCommands(SKILLS, { inThread: false }).map((c) => c.name);
    assert.ok(!home.includes("compact") && !home.includes("fork"), "thread-only commands are hidden without a thread");
  });

  it("ranks exact and prefix matches first, built-ins before skills", () => {
    const commands = slashCommands(SKILLS, { inThread: true });
    assert.deepEqual(
      matchSlash(commands, "p").map((c) => c.name),
      ["permissions", "compact", "plan"],
    );
    assert.equal(matchSlash(commands, "clear")[0]?.name, "new", "aliases match");
    assert.equal(matchSlash(commands, "thr")[0]?.name, "threejs");
    assert.deepEqual(matchSlash(commands, "zzz"), []);
  });

  it("resolves built-ins, skill shortcuts, /skill by id or name, and unknown names", () => {
    const commands = slashCommands(SKILLS, { inThread: true });
    const resolve = (text: string) => resolveSlash(parseSlash(text)!, commands, SKILLS);
    assert.deepEqual(resolve("/effort high"), { kind: "action", command: commands.find((c) => c.name === "effort"), args: "high" });
    assert.equal(resolve("/plan tidy").kind, "skill");
    const byId = resolve("/skill bundled:compact shrink it");
    assert.ok(byId.kind === "skill" && byId.skill.name === "compact" && byId.args === "shrink it", "a shadowed skill stays reachable");
    assert.deepEqual(resolve("/skill nope"), { kind: "unknown", name: "skill nope" });
    assert.deepEqual(resolve("/deploy now"), { kind: "unknown", name: "deploy" });
  });

  it("builds a skill turn that loads the skill, or inlines its body for user-only skills", () => {
    const plan = SKILLS[0]!;
    const loaded = skillTurn(plan, "tidy the API", "/plan tidy the API", null);
    assert.equal(loaded.displayText, "/plan tidy the API");
    assert.match(loaded.text, /read_skill with name "bundled:plan" first, then apply it to: tidy the API$/);
    const inline = skillTurn(plan, "", "/plan", "# Plan\nSteps.");
    assert.ok(inline.text.startsWith(SKILL_PREAMBLE));
    assert.match(inline.text, /<skill-body id="bundled:plan">\n# Plan\nSteps\.\n<\/skill-body>/);
    assert.match(inline.text, /conversation so far\.$/);
  });

  it("reads effort, permission and model words", () => {
    assert.equal(parseEffort("Off"), "none");
    assert.equal(parseEffort("auto"), null);
    assert.equal(parseEffort("extra high"), "xhigh");
    // Muse sends Ultra to the model as Max, so the word maps there.
    assert.equal(parseEffort("ultra"), "max");
    assert.equal(parseEffort("loud"), undefined);
    assert.equal(parseMode("full"), "allowAll");
    assert.equal(parseMode("Ask first"), "onRequest");
    assert.equal(parseMode("maybe"), undefined);
    const models = [{ modelId: "muse-spark-1.3", displayLabel: "Muse Spark 1.3" }, { modelId: "muse-max-2" , displayLabel: "Muse Max 2" }] as ModelOption[];
    const label = (id: string) => id;
    assert.equal(findModel(models, "muse max 2", label)?.modelId, "muse-max-2");
    assert.equal(findModel(models, "muse-sp", label)?.modelId, "muse-spark-1.3");
    assert.equal(findModel(models, "gpt", label), undefined);
  });

  it("gives a plugin skill its last name part as the shortcut", () => {
    const plugin = skill("plugin:threejs:threejs", { id: "plugin:threejs:threejs", scope: "plugin" });
    const commands = slashCommands([plugin], { inThread: true });
    assert.equal(commands.at(-1)?.name, "threejs");
    const byShort = resolveSlash(parseSlash("/skill threejs a scene")!, commands, [plugin]);
    assert.ok(byShort.kind === "skill" && byShort.skill.id === "plugin:threejs:threejs" && byShort.args === "a scene");
  });

  it("summarizes a long model-facing description to its first sentence", () => {
    assert.equal(skillSummary(skill("plan")), "Does plan things.");
    assert.equal(skillSummary(skill("x", { shortDescription: "Import a session" })), "Import a session");
  });
});

describe("saved Ultra effort", () => {
  it("carries on as Max, now that Ultra is out of the picker", async () => {
    const { defaultPrefs, revivePrefs } = await import("../src/model/store.js");
    assert.equal(revivePrefs({ effort: "ultra" }, defaultPrefs()).effort, "max");
    assert.equal(revivePrefs({ effort: "xhigh" }, defaultPrefs()).effort, "xhigh");
  });
});
