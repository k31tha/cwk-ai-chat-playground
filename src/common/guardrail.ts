import type { Turn } from "./utils.js";

export const GUARDRAIL_LABELS = ["ON_TOPIC", "OFF_TOPIC"] as const;
export type GuardrailLabel = (typeof GUARDRAIL_LABELS)[number];

/** What a guardrail call returns, whichever SDK made it. */
export type GuardrailResult = {
  label: GuardrailLabel;
  reason: string;
  /** The cheap model that produced the verdict */
  model: string;
};

/** The kinds of message the test cases mix together. */
export const GUARDRAIL_CATEGORIES = [
  "on_topic",
  "followup_in_context",
  "off_topic",
  "followup_off_topic",
  "injection",
  "borderline",
] as const;
export type GuardrailCategory = (typeof GUARDRAIL_CATEGORIES)[number];

export type GuardrailCase = {
  id: string;
  category: GuardrailCategory;
  /** Earlier turns of the chat; empty for a first message */
  history: Turn[];
  /** The new message the guardrail must classify */
  prompt: string;
  expected: GuardrailLabel;
  /** Why the generator chose this label (for reviewing the cases) */
  rationale: string;
};

export type GuardrailCaseFile = {
  generatedAt: string;
  generatedBy: string;
  cases: GuardrailCase[];
};
