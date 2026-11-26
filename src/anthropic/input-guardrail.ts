// Input guardrail call for the Anthropic SDK. A cheap model (guardrailModel in
// config.ts) classifies a message as ON_TOPIC or OFF_TOPIC, given the
// conversation so far. Used by basic-chat-add-input-guardrail.ts and by
// src/utils/evaluate-input-guardrail.ts.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import dotenv from "dotenv";
import { z } from "zod";
import {
  GUARDRAIL_LABELS,
  type GuardrailResult,
} from "../common/guardrail.js";
import { inputGuardrailSystemPrompt } from "../common/prompt-ref.js";
import { buildGuardrailInput, type Turn } from "../common/utils.js";
import { guardrailModel } from "./config.js";

dotenv.config({ quiet: true });

// Created on first use so importing this file never needs an API key
let client: Anthropic | undefined;

// Structured outputs (output_config.format) constrain the cheap model's reply to
// this schema. It is written in Zod here, and parse() returns it typed.
const VerdictSchema = z.object({
  label: z.enum(GUARDRAIL_LABELS),
  reason: z.string().describe("One short sentence."),
});

/**
 * Classifies `text`. `turns` is the conversation so far, so short follow-ups are
 * judged in context. Throws if no verdict comes back (callers decide what to do).
 */
export const runInputGuardrail = async (
  text: string,
  turns: Turn[] = [],
): Promise<GuardrailResult> => {
  client ??= new Anthropic();
  const response = await client.messages.parse({
    model: guardrailModel,
    // Generous: thinking (on by default on Claude 5) shares this budget, and a
    // truncated reply cannot be parsed
    max_tokens: 1024,
    system: inputGuardrailSystemPrompt,
    // Conversation and new message are wrapped in tags so they are treated as data
    messages: [{ role: "user", content: buildGuardrailInput(turns, text) }],
    output_config: { format: zodOutputFormat(VerdictSchema) },
  });
  // null if the reply was cut off or refused
  if (!response.parsed_output) {
    throw new Error(`no verdict returned (${response.stop_reason})`);
  }
  return { ...response.parsed_output, model: guardrailModel };
};
