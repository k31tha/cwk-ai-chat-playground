// Input check using OpenAI's Moderation API (a free endpoint, no chat model).
// It is used by basic-chat-add-input-moderation.ts in both the anthropic and
// openai folders. Note what it does and does not do: it flags harmful content
// (hate, harassment, self-harm, sexual, violence, illicit...). It has no idea
// what a "travel assistant" is, so an off-topic but harmless message such as a
// maths question passes. Compare with input-guardrail.ts, which checks topic.
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ quiet: true });

export const moderationModel = "omni-moderation-latest";

export type ModerationResult = {
  /** true when the message should be blocked */
  flagged: boolean;
  /** One short sentence, in the same style as the guardrail's reason */
  reason: string;
  model: string;
  /** Categories that were flagged, e.g. ["harassment", "violence"] */
  categories: string[];
};

// Created on first use so importing this file never needs an API key
let client: OpenAI | undefined;

/** Checks `text`. Throws if the call fails (callers decide what to do). */
export const runInputModeration = async (text: string): Promise<ModerationResult> => {
  client ??= new OpenAI();
  const response = await client.moderations.create({ model: moderationModel, input: text });
  const result = response.results[0];
  if (!result) throw new Error("moderation returned no result");

  const categories = Object.entries(result.categories)
    .filter(([, hit]) => hit)
    .map(([name]) => name);
  return {
    flagged: result.flagged,
    reason: result.flagged
      ? `Flagged by moderation: ${categories.join(", ")}.`
      : "No moderation category was flagged.",
    model: moderationModel,
    categories,
  };
};
