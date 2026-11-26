// Input guardrail call for the OpenAI SDK. A cheap model (guardrailModel in
// config.ts) classifies a message as ON_TOPIC or OFF_TOPIC, given the
// conversation so far. Used by basic-chat-add-input-guardrail.ts and by
// src/utils/evaluate-input-guardrail.ts.
import dotenv from "dotenv";
import OpenAI from "openai";
import {
  GUARDRAIL_LABELS,
  type GuardrailLabel,
  type GuardrailResult,
} from "../common/guardrail.js";
import { inputGuardrailSystemPrompt } from "../common/prompt-ref.js";
import { buildGuardrailInput, type Turn } from "../common/utils.js";
import { guardrailModel } from "./config.js";

dotenv.config({ quiet: true });

// Created on first use so importing this file never needs an API key
let client: OpenAI | undefined;

/**
 * Classifies `text`. `turns` is the conversation so far, so short follow-ups are
 * judged in context. Throws if no verdict comes back (callers decide what to do).
 */
export const runInputGuardrail = async (
  text: string,
  turns: Turn[] = [],
): Promise<GuardrailResult> => {
  client ??= new OpenAI();
  // This call is deliberately not part of any stored conversation (no
  // `conversation` id, store: false), so checked input leaves no trace there.
  const response = await client.responses.create({
    model: guardrailModel,
    instructions: inputGuardrailSystemPrompt,
    // Conversation and new message are wrapped in tags so they are treated as data
    input: buildGuardrailInput(turns, text),
    store: false,
    // Structured output makes the cheap model return a parseable verdict
    text: {
      format: {
        type: "json_schema",
        name: "verdict",
        strict: true,
        schema: {
          type: "object",
          properties: {
            label: { type: "string", enum: [...GUARDRAIL_LABELS] },
            reason: { type: "string", description: "One short sentence." },
          },
          required: ["label", "reason"],
          additionalProperties: false,
        },
      },
    },
  });
  const { label, reason } = JSON.parse(response.output_text) as {
    label: GuardrailLabel;
    reason: string;
  };
  return { label, reason, model: guardrailModel };
};
