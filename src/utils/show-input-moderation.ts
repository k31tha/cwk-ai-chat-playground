// Shows what the OpenAI Moderation API is sent and what it sends back, so the
// structure of the output can be read first-hand.
//
//   pnpm tsx src/utils/show-input-moderation.ts                      three built-in samples
//   pnpm tsx src/utils/show-input-moderation.ts "some message"       your own message(s)
//   pnpm tsx src/utils/show-input-moderation.ts --scores "message"   also show every category score
//
// For each message it prints, in order: the request, the raw response from
// OpenAI, then the short summary the chat examples act on (flagged, reason).
// Messages are sent one at a time. Needs OPENAI_API_KEY; the call is free.
import { parseArgs } from "node:util";
import { moderate, moderationModel, summariseModeration } from "../openai/input-moderation.js";

const SAMPLES = [
  "Plan 5 days in Lisbon in May",
  "What is 17 times 23?",
  "I will hurt you and everyone in this hotel",
];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { scores: { type: "boolean", default: false } },
});
const messages = positionals.length ? positionals : SAMPLES;

for (const [i, text] of messages.entries()) {
  console.log(`\n${"=".repeat(72)}\nMessage ${i + 1} of ${messages.length}\n${"=".repeat(72)}`);

  const request = { model: moderationModel, input: text };
  console.log("\n--- request: client.moderations.create(...)");
  console.log(JSON.stringify(request, null, 2));

  try {
    const response = await moderate(text);

    // The raw response is long (13 categories x 3 objects). By default the
    // scores are cut to the three highest; --scores shows them all.
    const raw = structuredClone(response);
    const result = raw.results[0];
    if (result && !values.scores) {
      const top = Object.entries(result.category_scores)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);
      (result as { category_scores: unknown }).category_scores = {
        ...Object.fromEntries(top),
        "...": `${Object.keys(result.category_scores).length - top.length} more, use --scores`,
      };
    }
    console.log("\n--- response (raw from OpenAI)");
    // Keep the one-item arrays ["text"] on one line so the output stays short
    console.log(JSON.stringify(raw, null, 2).replace(/\[\s+("[^"]*")\s+\]/g, "[$1]"));

    console.log("\n--- summary used by the chat examples (summariseModeration)");
    const { flagged, reason, categories } = summariseModeration(response);
    console.log(JSON.stringify({ flagged, categories, reason }, null, 2));
  } catch (err) {
    console.log(`\n--- error\n${String(err)}`);
  }
}
