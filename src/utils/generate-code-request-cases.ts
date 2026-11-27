// Generates a JSON file of test cases for the guardrail's programming-help rule:
// travel-flavoured requests for code (expected OFF_TOPIC) mixed with travel
// questions that merely mention technology (expected ON_TOPIC), so the rule is
// tested for both misses and false blocks. For src/utils/evaluate-input-guardrail.ts.
//
//   pnpm tsx src/utils/generate-code-request-cases.ts --count 40 --out guardrail-cases-code-generated
//
// --count / -n  how many cases (default 40): half code requests, half controls
// --out   / -o  file name (default "guardrail-cases-code-generated"); a bare name
//               goes in data/, a path is used as given
//
// Written by the main Anthropic model, so review the `rationale` of each case:
// the labels are the generator's judgement. Prompts already in
// data/guardrail-cases-code.json are passed to the model so it does not repeat them.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import dotenv from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { model } from "../anthropic/config.js";
import type { GuardrailCase, GuardrailCaseFile, GuardrailLabel } from "../common/guardrail.js";
import { DATA_DIR, resolveCasesPath } from "./paths.js";

dotenv.config({ quiet: true });

const TOPIC_DEFINITION =
  "The assistant is a travel assistant. ON_TOPIC: destinations, flights, hotels, visas, packing, " +
  "itineraries, local food/culture, budgets, travel insurance, weather for trips. OFF_TOPIC: anything else, " +
  "including requests to write, debug or explain code, even when the code is about travel.";

type Kind = {
  expected: GuardrailLabel;
  text: string;
};

const KINDS: Record<"code" | "control", Kind> = {
  code: {
    expected: "OFF_TOPIC",
    text:
      "A request for programming help that is about a travel subject: scraping or comparing flight or hotel " +
      "prices, booking forms, itinerary or route-optimising code, currency or budget calculators, visa or " +
      "passport form validation, map or weather API calls, trip-planner databases, travel blog or booking " +
      "site code. Vary the language (Python, JavaScript, TypeScript, SQL, regex, shell, Go) and the kind " +
      "of request (write, debug, explain, review, convert).",
  },
  control: {
    expected: "ON_TOPIC",
    text:
      "A genuine travel question that mentions technology, software or the internet innocently, so that a " +
      "crude keyword filter might block it: comparing flight price websites, booking online versus in " +
      "person, travel budgeting apps, applying for a visa online, eSIMs and wifi for a trip, packing for " +
      "a remote developer, digital nomad visas, which cities suit people who work online, offline maps. " +
      "It must ask for travel advice or information and contain no request for code.",
  },
};

const GeneratedSchema = z.object({
  cases: z.array(
    z.object({
      prompt: z.string(),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })),
      rationale: z.string().describe("One short sentence."),
    }),
  ),
});

const MAX_PER_CALL = 12;
const client = new Anthropic();

const generate = async (kind: keyof typeof KINDS, wanted: number, avoid: string[]) => {
  const response = await client.messages.parse({
    model,
    max_tokens: 8000,
    system:
      "You write test cases for the input guardrail of a travel assistant, specifically for its rule about " +
      `programming requests. ${TOPIC_DEFINITION}`,
    messages: [
      {
        role: "user",
        content:
          `Write exactly ${wanted} test messages.\n${KINDS[kind].text}\n` +
          "Vary length, tone and style (some casual, some with typos). Make about a quarter of them follow-ups " +
          "in an ongoing travel chat: give those 2-4 earlier turns in history (oldest first), and for a " +
          "follow-up the message should only make sense, or only switch topic, because of that history. " +
          "Leave history empty for the rest.\n" +
          (avoid.length ? `Do not repeat or closely paraphrase these:\n${avoid.map((p) => `- ${p}`).join("\n")}\n` : ""),
      },
    ],
    output_config: { format: zodOutputFormat(GeneratedSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`no cases returned for ${kind} (${response.stop_reason})`);
  }
  return response.parsed_output.cases;
};

const shuffle = <T>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
};

const { values } = parseArgs({
  options: {
    count: { type: "string", short: "n", default: "40" },
    out: { type: "string", short: "o", default: "guardrail-cases-code-generated" },
  },
});

const count = Number(values.count);
if (!Number.isInteger(count) || count < 2) {
  console.error(`--count must be a whole number of at least 2, got "${values.count}"`);
  process.exit(1);
}

// Prompts already in the hand-made set, so the model does not repeat them
let existing: string[] = [];
try {
  const raw = JSON.parse(await readFile(path.join(DATA_DIR, "guardrail-cases-code.json"), "utf-8")) as {
    cases: { prompt: string }[];
  };
  existing = raw.cases.map((c) => c.prompt);
} catch {
  // the file is optional
}

const wantedByKind = { code: Math.ceil(count / 2), control: Math.floor(count / 2) };
const cases: GuardrailCase[] = [];
for (const kind of ["code", "control"] as const) {
  const kept: GuardrailCase[] = [];
  for (let attempt = 0; attempt < 4 && kept.length < wantedByKind[kind]; attempt++) {
    const batch = await generate(kind, Math.min(MAX_PER_CALL, wantedByKind[kind] - kept.length), [
      ...existing,
      ...kept.map((c) => c.prompt),
    ]);
    for (const c of batch) {
      if (kept.length >= wantedByKind[kind]) break;
      const followUp = c.history.length > 0;
      kept.push({
        id: `${kind}-${kept.length + 1}`,
        // Same category names the evaluator already knows
        category: followUp ? (kind === "code" ? "followup_off_topic" : "followup_in_context") : "borderline",
        history: c.history,
        prompt: c.prompt,
        expected: KINDS[kind].expected,
        rationale: c.rationale,
      });
    }
  }
  if (kept.length < wantedByKind[kind]) {
    console.warn(`[warn] only ${kept.length} of ${wantedByKind[kind]} ${kind} cases generated`);
  }
  console.log(`${kind}: ${kept.length}`);
  cases.push(...kept);
}

const file: GuardrailCaseFile = {
  generatedAt: new Date().toISOString(),
  generatedBy: model,
  cases: shuffle(cases),
};

const outPath = resolveCasesPath(values.out);
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
console.log(`\nWrote ${cases.length} cases to ${outPath}`);
