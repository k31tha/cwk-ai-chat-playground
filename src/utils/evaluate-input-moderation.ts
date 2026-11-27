// Runs a JSON file of test cases through the moderation check and the topic
// guardrail, one case at a time, and compares them on the same cases. Works with
// the files made by generate-moderation-cases.ts and generate-guardrail-cases.ts.
//
//   pnpm tsx src/utils/evaluate-input-moderation.ts [cases-file] [--sdk a|o] [--moderation-only] [--repeat N]
//
// cases-file         name of the cases JSON (default "moderation-cases"). A bare
//                    name is read from data/; a path is used as given.
// --sdk / -s         which guardrail to compare with: a = Anthropic, o = OpenAI.
//                    Leave it out to run both.
// --moderation-only  skip the guardrails (moderation is free)
// --repeat / -r      run every case N times (default 1) to see whether a verdict
//                    is stable. An LLM guardrail can answer differently on the
//                    same input; a case whose runs disagree is reported as unstable.
//
// Each case is scored as "should this input be blocked?" (expected OFF_TOPIC =
// block). Checks compared: moderation alone, each guardrail alone, and
// moderation + guardrail (blocked if either blocks, as the chat examples do).
//
// Output: a few lines per case, then a short summary per check. The rows are also
// saved in data/results/. Nothing runs in parallel, so the lines appear in order.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runInputGuardrail as runAnthropic } from "../anthropic/input-guardrail.js";
import { GUARDRAIL_LABELS } from "../common/guardrail.js";
import { runInputGuardrail as runOpenAI } from "../openai/input-guardrail.js";
import { runInputModeration } from "../openai/input-moderation.js";
import { RESULTS_DIR, resolveCasesPath } from "./paths.js";

const CaseFileSchema = z.object({
  cases: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
      prompt: z.string(),
      expected: z.enum(GUARDRAIL_LABELS),
    }),
  ),
});

const GUARDRAILS = {
  a: { name: "anthropic", run: runAnthropic },
  o: { name: "openai", run: runOpenAI },
} as const;

type Decision = "blocked" | "allowed" | "error";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sdk: { type: "string", short: "s" },
    "moderation-only": { type: "boolean", default: false },
    repeat: { type: "string", short: "r", default: "1" },
  },
});

if (values.sdk !== undefined && values.sdk !== "a" && values.sdk !== "o") {
  console.error(`--sdk must be "a" (Anthropic) or "o" (OpenAI), got "${values.sdk}"`);
  process.exit(1);
}
const repeat = Number(values.repeat);
if (!Number.isInteger(repeat) || repeat < 1) {
  console.error(`--repeat must be a positive whole number, got "${values.repeat}"`);
  process.exit(1);
}
const guardrails = values["moderation-only"] ? [] : values.sdk ? [GUARDRAILS[values.sdk]] : [GUARDRAILS.a, GUARDRAILS.o];

const casesPath = resolveCasesPath(positionals[0] ?? "moderation-cases");
let parsed: z.infer<typeof CaseFileSchema>;
try {
  parsed = CaseFileSchema.parse(JSON.parse(await readFile(casesPath, "utf-8")));
} catch (err) {
  console.error(`Could not load cases from ${casesPath}\n${String(err)}`);
  process.exit(1);
}

const toDecision = (blocked: boolean): Decision => (blocked ? "blocked" : "allowed");

/** The combined check blocks if either part blocks; otherwise an error counts as an error. */
const combine = (a: Decision, b: Decision): Decision =>
  a === "blocked" || b === "blocked" ? "blocked" : a === "error" || b === "error" ? "error" : "allowed";

// One flat row per case. `decisions` holds, for every check, one decision per run
// (a single item unless --repeat is used).
type Row = {
  id: string;
  category: string;
  prompt: string;
  expected: "block" | "allow";
  /** Categories moderation flagged on the first run, empty if none */
  flagged: string[];
  decisions: Record<string, Decision[]>;
};

const isUnstable = (runs: Decision[]) => new Set(runs).size > 1;
/** "blocked" when every run agrees, otherwise the runs in order, marked unstable */
const show = (runs: Decision[]) => (isUnstable(runs) ? `${runs.join("/")}(UNSTABLE)` : (runs[0] ?? "error"));

console.log(
  `${parsed.cases.length} cases, one at a time${repeat > 1 ? `, ${repeat} runs each` : ""}: ` +
    `moderation${guardrails.map((g) => ` + ${g.name} guardrail`).join("")}\n`,
);

const rows: Row[] = [];
for (const [i, c] of parsed.cases.entries()) {
  const decisions: Record<string, Decision[]> = { moderation: [] };
  for (const g of guardrails) {
    decisions[g.name] = [];
    decisions[`moderation+${g.name}`] = [];
  }
  let flagged: string[] = [];

  for (let run = 0; run < repeat; run++) {
    let moderation: Decision;
    try {
      const m = await runInputModeration(c.prompt);
      moderation = toDecision(m.flagged);
      if (run === 0) flagged = m.categories;
    } catch {
      moderation = "error";
    }
    decisions.moderation?.push(moderation);

    for (const g of guardrails) {
      let guardrail: Decision;
      try {
        guardrail = toDecision((await g.run(c.prompt, c.history)).label === "OFF_TOPIC");
      } catch {
        guardrail = "error";
      }
      decisions[g.name]?.push(guardrail);
      decisions[`moderation+${g.name}`]?.push(combine(moderation, guardrail));
    }
  }

  const row: Row = {
    id: c.id,
    category: c.category,
    prompt: c.prompt,
    expected: c.expected === "OFF_TOPIC" ? "block" : "allow",
    flagged,
    decisions,
  };
  rows.push(row);
  console.log(`${String(i + 1).padStart(2)}/${parsed.cases.length} ${row.id}`);
  console.log(`   expected ${row.expected}${flagged.length ? `  (moderation flagged: ${flagged.join(", ")})` : ""}`);
  console.log(`   ${Object.entries(decisions).map(([name, runs]) => `${name}=${show(runs)}`).join("  ")}`);
}

// --- summary: one short object per check ------------------------------------
const checkNames = Object.keys(rows[0]?.decisions ?? {});
const summary = Object.fromEntries(
  checkNames.map((name) => {
    // Every run of every case counts once
    const runs = rows.flatMap((r) => (r.decisions[name] ?? []).map((d) => ({ r, d })));
    const total = runs.length;
    const entry: Record<string, unknown> = {
      right: `${runs.filter(({ r, d }) => d === (r.expected === "block" ? "blocked" : "allowed")).length}/${total}`,
      // a legitimate message was blocked
      falseBlocks: runs.filter(({ r, d }) => r.expected === "allow" && d === "blocked").length,
      // something that should be blocked got through
      missedBlocks: runs.filter(({ r, d }) => r.expected === "block" && d === "allowed").length,
      errors: runs.filter(({ d }) => d === "error").length,
    };
    if (repeat > 1) {
      // cases where the runs disagreed with each other
      entry.unstable = rows.filter((r) => isUnstable(r.decisions[name] ?? [])).map((r) => r.id);
    }
    return [name, entry];
  }),
);
console.log(`\nsummary${repeat > 1 ? ` (${repeat} runs per case; right, falseBlocks, missedBlocks and errors count runs)` : ""}`);
console.log(JSON.stringify(summary, null, 2));

// --- save -------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = path.join(RESULTS_DIR, `${path.basename(casesPath, ".json")}-moderation-${stamp}.json`);
await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(outPath, `${JSON.stringify({ casesFile: casesPath, repeat, summary, rows }, null, 2)}\n`, "utf-8");
console.log(`\nSaved to ${outPath}`);
