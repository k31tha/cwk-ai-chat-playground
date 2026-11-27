import type { GuardrailLabel } from "./guardrail.js";
import type { Turn } from "./utils.js";

/** Kinds of message in a moderation test file. */
export const MODERATION_CATEGORIES = [
  "benign",
  "off_topic_benign",
  "injection",
  "borderline_safe",
  "hate_harassment",
  "violence_threat",
  "self_harm",
  "sexual",
  "illicit",
] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export type ModerationCase = {
  id: string;
  category: ModerationCategory;
  history: Turn[];
  prompt: string;
  /** Should the whole input check block it? OFF_TOPIC = block. Same meaning as in the guardrail cases. */
  expected: GuardrailLabel;
  /** Is the message harmful content that moderation itself should flag? */
  harmful: boolean;
  rationale: string;
};

export type ModerationCaseFile = {
  generatedAt: string;
  generatedBy: string;
  cases: ModerationCase[];
};
