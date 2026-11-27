// Runs a JSON file of test cases through the moderation check and the topic
// guardrail, and compares them on the same cases. Works with the files made by
// generate-moderation-cases.ts and by generate-guardrail-cases.ts.
//
//   pnpm tsx src/utils/evaluate-input-moderation.ts [cases-file] [--sdk a|o] [--moderation-only]
//
// cases-file         name of the cases JSON (default "moderation-cases"). A bare
//                    name is read from data/; a path is used as given.
// --sdk / -s         which guardrail to compare with: a = Anthropic, o = OpenAI.
//                    Leave it out to run both.
// --moderation-only  skip the guardrails (free: moderation costs nothing)
//
// Every case is scored as "should this input be blocked?" (expected OFF_TOPIC =
// block). Checks compared: moderation alone, each guardrail alone, and
// moderation + guardrail together (blocked if either blocks, which is what the
// basic-chat-add-input-moderation.ts examples do). Where a case has `harmful`,
// moderation is also scored on that alone.
//
// Each case is logged as one JSON line (prompt, expected, harmful, and each
// check's verdict), then a summary is printed and the full JSON saved in
// data/results/.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { runInputGuardrail as runAnthropic } from "../anthropic/input-guardrail.js";
import { GUARDRAIL_LABELS, type GuardrailLabel } from "../common/guardrail.js";
import { runInputGuardrail as runOpenAI } from "../openai/input-guardrail.js";
import { runInputModeration } from "../openai/input-moderation.js";
import { RESULTS_DIR, resolveCasesPath } from "./paths.js";
import { mapPool } from "./pool.js";

const CaseFileSchema = z.object({
  cases: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
      prompt: z.string(),
      expected: z.enum(GUARDRAIL_LABELS),
      harmful: z.boolean().optional(),
    }),
  ),
});

const GUARDRAILS = {
  a: { name: "anthropic", run: runAnthropic },
  o: { name: "openai", run: runOpenAI },
} as const;

/** true = blocked, false = allowed, "ERROR" = the check failed */
type Verdict = boolean | "ERROR";

type Row = {
  id: string;
  category: string;
  prompt: string;
  expected: GuardrailLabel;
  harmful?: boolean;
  moderation: { verdict: Verdict; categories: string[]; ms: number };
  /** guardrail name -> verdict and reason */
  guardrails: Record<string, { verdict: Verdict; reason: string; ms: number }>;
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sdk: { type: "string", short: "s" },
    concurrency: { type: "string", short: "c", default: "4" },
    "moderation-only": { type: "boolean", default: false },
  },
});

if (values.sdk !== undefined && values.sdk !== "a" && values.sdk !== "o") {
  console.error(`--sdk must be "a" (Anthropic) or "o" (OpenAI), got "${values.sdk}"`);
  process.exit(1);
}
const selected = values["moderation-only"] ? [] : values.sdk ? [GUARDRAILS[values.sdk]] : [GUARDRAILS.a, GUARDRAILS.o];
const concurrency = Math.max(1, Number(values.concurrency) || 4);

const casesPath = resolveCasesPath(positionals[0] ?? "moderation-cases");
let parsed: z.infer<typeof CaseFileSchema>;
try {
  parsed = CaseFileSchema.parse(JSON.parse(await readFile(casesPath, "utf-8")));
} catch (err) {
  console.error(`Could not load cases from ${casesPath}\n${String(err)}`);
  process.exit(1);
}

console.log(
  `# ${parsed.cases.length} cases; moderation${selected.map((s) => ` + ${s.name} guardrail`).join("")}`,
);

const rows = await mapPool(parsed.cases, concurrency, async (c): Promise<Row> => {
  const row: Row = {
    id: c.id,
    category: c.category,
    prompt: c.prompt,
    expected: c.expected,
    harmful: c.harmful,
    moderation: { verdict: "ERROR", categories: [], ms: 0 },
    guardrails: {},
  };

  let started = Date.now();
  try {
    const m = await runInputModeration(c.prompt);
    row.moderation = { verdict: m.flagged, categories: m.categories, ms: Date.now() - started };
  } catch {
    row.moderation.ms = Date.now() - started;
  }

  await Promise.all(
    selected.map(async (g) => {
      const t = Date.now();
      try {
        const v = await g.run(c.prompt, c.history);
        row.guardrails[g.name] = { verdict: v.label === "OFF_TOPIC", reason: v.reason, ms: Date.now() - t };
      } catch (err) {
        row.guardrails[g.name] = { verdict: "ERROR", reason: String(err), ms: Date.now() - t };
      }
    }),
  );

  console.log(
    JSON.stringify({
      id: row.id,
      prompt: row.prompt,
      expected: row.expected,
      harmful: row.harmful,
      moderation: row.moderation.verdict,
      ...Object.fromEntries(selected.map((g) => [g.name, row.guardrails[g.name]?.verdict])),
    }),
  );
  return row;
});

// --- scoring ---------------------------------------------------------------
/** Blocked if either check blocks; an error blocks (fail closed) unless the other already did. */
const either = (a: Verdict, b: Verdict): Verdict => {
  if (a === true || b === true) return true;
  if (a === "ERROR" || b === "ERROR") return "ERROR";
  return false;
};

type Check = { name: string; verdictOf: (r: Row) => Verdict };
const checks: Check[] = [
  { name: "moderation", verdictOf: (r) => r.moderation.verdict },
  ...selected.flatMap((g): Check[] => [
    { name: `guardrail-${g.name}`, verdictOf: (r) => r.guardrails[g.name]?.verdict ?? "ERROR" },
    {
      name: `moderation+guardrail-${g.name}`,
      verdictOf: (r) => either(r.moderation.verdict, r.guardrails[g.name]?.verdict ?? "ERROR"),
    },
  ]),
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] ?? 0) : 0;
};

const summarise = (check: Check) => {
  const shouldBlock = (r: Row) => r.expected === "OFF_TOPIC";
  const scored = rows.map((r) => ({ r, v: check.verdictOf(r) }));
  const passed = scored.filter(({ r, v }) => v !== "ERROR" && v === shouldBlock(r));
  const byCategory: Record<string, string> = {};
  for (const category of [...new Set(rows.map((r) => r.category))]) {
    const inCat = scored.filter(({ r }) => r.category === category);
    byCategory[category] = `${inCat.filter(({ r, v }) => v !== "ERROR" && v === shouldBlock(r)).length}/${inCat.length}`;
  }
  return {
    total: rows.length,
    passed: passed.length,
    accuracy: Number((passed.length / rows.length).toFixed(3)),
    // legitimate travel messages that were blocked
    falseBlocks: scored.filter(({ r, v }) => !shouldBlock(r) && v === true).length,
    // off-topic or harmful messages that got through
    missedBlocks: scored.filter(({ r, v }) => shouldBlock(r) && v === false).length,
    errors: scored.filter(({ v }) => v === "ERROR").length,
    byCategory,
  };
};

const summary: Record<string, unknown> = {};
for (const check of checks) summary[check.name] = summarise(check);

// Moderation judged on harm alone, for the cases that say whether they are harmful
const harmRows = rows.filter((r) => r.harmful !== undefined);
if (harmRows.length) {
  summary["moderation-vs-harm-label"] = {
    total: harmRows.length,
    caught: harmRows.filter((r) => r.harmful && r.moderation.verdict === true).length,
    harmfulTotal: harmRows.filter((r) => r.harmful).length,
    missedHarmful: harmRows.filter((r) => r.harmful && r.moderation.verdict === false).length,
    flaggedHarmless: harmRows.filter((r) => !r.harmful && r.moderation.verdict === true).length,
    harmlessTotal: harmRows.filter((r) => !r.harmful).length,
    errors: harmRows.filter((r) => r.moderation.verdict === "ERROR").length,
  };
}

summary["medianMs"] = {
  moderation: median(rows.map((r) => r.moderation.ms)),
  ...Object.fromEntries(selected.map((g) => [g.name, median(rows.map((r) => r.guardrails[g.name]?.ms ?? 0))])),
};

console.log("\n# summary");
console.log(JSON.stringify(summary, null, 2));

// --- save ------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const tag = ["moderation", ...selected.map((s) => s.name)].join("-");
const outPath = path.join(RESULTS_DIR, `${path.basename(casesPath, ".json")}-${tag}-${stamp}.json`);
await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(
  outPath,
  `${JSON.stringify({ casesFile: casesPath, runAt: new Date().toISOString(), summary, rows }, null, 2)}\n`,
  "utf-8",
);
console.log(`\nFull results saved to ${outPath}`);
