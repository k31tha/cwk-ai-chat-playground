// Runs a JSON file of guardrail test cases (see generate-guardrail-cases.ts)
// through the input guardrail and logs expected versus actual for each one.
//
//   pnpm tsx src/utils/evaluate-input-guardrail.ts [cases-file] [--sdk a|o]
//
// cases-file  name of the cases JSON (default "guardrail-cases"). A bare name is
//             read from data/; a path is used as given.
// --sdk / -s  a = Anthropic, o = OpenAI. Leave it out to run both.
//
// Each result is logged as one JSON line (sdk, model, prompt, expected, actual,
// pass), then a summary is printed and the full JSON is saved in data/results/.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { guardrailModel as anthropicModel } from "../anthropic/config.js";
import { runInputGuardrail as runAnthropic } from "../anthropic/input-guardrail.js";
import {
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_LABELS,
  type GuardrailLabel,
} from "../common/guardrail.js";
import { guardrailModel as openaiModel } from "../openai/config.js";
import { runInputGuardrail as runOpenAI } from "../openai/input-guardrail.js";
import { RESULTS_DIR, resolveCasesPath } from "./paths.js";
import { mapPool } from "./pool.js";

const CaseFileSchema = z.object({
  cases: z.array(
    z.object({
      id: z.string(),
      category: z.enum(GUARDRAIL_CATEGORIES),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
      prompt: z.string(),
      expected: z.enum(GUARDRAIL_LABELS),
    }),
  ),
});

const SDKS = {
  a: { name: "anthropic", model: anthropicModel, run: runAnthropic },
  o: { name: "openai", model: openaiModel, run: runOpenAI },
} as const;

type EvalResult = {
  id: string;
  category: string;
  sdk: string;
  model: string;
  prompt: string;
  expected: GuardrailLabel;
  actual: GuardrailLabel | "ERROR";
  reason: string;
  pass: boolean;
  ms: number;
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sdk: { type: "string", short: "s" },
    concurrency: { type: "string", short: "c", default: "4" },
  },
});

if (values.sdk !== undefined && values.sdk !== "a" && values.sdk !== "o") {
  console.error(`--sdk must be "a" (Anthropic) or "o" (OpenAI), got "${values.sdk}"`);
  process.exit(1);
}
const selected = values.sdk ? [SDKS[values.sdk]] : [SDKS.a, SDKS.o];
const concurrency = Math.max(1, Number(values.concurrency) || 4);

const casesName = positionals[0] ?? "guardrail-cases";
const casesPath = resolveCasesPath(casesName);
let parsed: z.infer<typeof CaseFileSchema>;
try {
  parsed = CaseFileSchema.parse(JSON.parse(await readFile(casesPath, "utf-8")));
} catch (err) {
  console.error(`Could not load cases from ${casesPath}\n${String(err)}`);
  process.exit(1);
}

const results: EvalResult[] = [];
for (const sdk of selected) {
  console.log(`\n# ${sdk.name} (${sdk.model}), ${parsed.cases.length} cases`);
  const sdkResults = await mapPool(parsed.cases, concurrency, async (c) => {
    const started = Date.now();
    let result: EvalResult;
    try {
      const verdict = await sdk.run(c.prompt, c.history);
      result = {
        id: c.id,
        category: c.category,
        sdk: sdk.name,
        model: verdict.model,
        prompt: c.prompt,
        expected: c.expected,
        actual: verdict.label,
        reason: verdict.reason,
        pass: verdict.label === c.expected,
        ms: Date.now() - started,
      };
    } catch (err) {
      result = {
        id: c.id,
        category: c.category,
        sdk: sdk.name,
        model: sdk.model,
        prompt: c.prompt,
        expected: c.expected,
        actual: "ERROR",
        reason: String(err),
        pass: false,
        ms: Date.now() - started,
      };
    }
    const { sdk: s, model, prompt, expected, actual, pass } = result;
    console.log(JSON.stringify({ sdk: s, model, prompt, expected, actual, pass }));
    return result;
  });
  results.push(...sdkResults);
}

// --- summary ---------------------------------------------------------------
const summarise = (rows: EvalResult[]) => ({
  total: rows.length,
  passed: rows.filter((r) => r.pass).length,
  accuracy: rows.length ? Number((rows.filter((r) => r.pass).length / rows.length).toFixed(3)) : 0,
  // legitimate travel messages that were blocked
  falseBlocks: rows.filter((r) => r.expected === "ON_TOPIC" && r.actual === "OFF_TOPIC").length,
  // off-topic or hostile messages that got through
  missedBlocks: rows.filter((r) => r.expected === "OFF_TOPIC" && r.actual === "ON_TOPIC").length,
  errors: rows.filter((r) => r.actual === "ERROR").length,
});

const summary: Record<string, ReturnType<typeof summarise> & { byCategory: Record<string, string> }> = {};
for (const sdk of selected) {
  const rows = results.filter((r) => r.sdk === sdk.name);
  const byCategory: Record<string, string> = {};
  for (const category of GUARDRAIL_CATEGORIES) {
    const inCategory = rows.filter((r) => r.category === category);
    if (inCategory.length) {
      byCategory[category] = `${inCategory.filter((r) => r.pass).length}/${inCategory.length}`;
    }
  }
  summary[sdk.name] = { ...summarise(rows), byCategory };
}
console.log("\n# summary");
console.log(JSON.stringify(summary, null, 2));

// --- save ------------------------------------------------------------------
const sdkTag = selected.map((s) => s.name).join("-");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = path.join(RESULTS_DIR, `${path.basename(casesPath, ".json")}-${sdkTag}-${stamp}.json`);
await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(
  outPath,
  `${JSON.stringify({ casesFile: casesPath, runAt: new Date().toISOString(), summary, results }, null, 2)}\n`,
  "utf-8",
);
console.log(`\nFull results saved to ${outPath}`);
