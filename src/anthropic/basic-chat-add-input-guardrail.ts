// Variant of basic-chat-with-tools-reasoning.ts that adds an INPUT GUARDRAIL.
// Every user message (the holiday prompt and each follow-up) is first checked by
// a cheap, fast model (guardrailModel in config.ts) that returns a structured
// verdict. Only allowed messages reach the main model; blocked ones are rejected
// with a reason and never enter the conversation history. Kept as a separate
// file so the other examples stay unchanged.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import dotenv from "dotenv";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import {
  addTimePeriod,
  askHolidayPrompt,
  buildGuardrailInput,
  getWeather,
  type TimePeriod,
  type Turn,
} from "../common/utils.js";
import {
  basicTravelSystemPrompt,
  inputGuardrailSystemPrompt,
} from "../common/prompt-ref.js";
import { guardrailModel, model } from "./config.js";

// Load environment variables
dotenv.config();

const client = new Anthropic();

type Content = string | Anthropic.ContentBlockParam[];

const toContent = (input: Content | Anthropic.Message): Content =>
  typeof input === "string" || Array.isArray(input) ? input : input.content;

const add_user_message = (
  messages: Anthropic.MessageParam[],
  message: Content | Anthropic.Message,
) => {
  messages.push({ role: "user", content: toContent(message) });
};

// Passing the whole Message keeps every content block (including thinking and
// tool_use blocks), which the API needs to see again on the next request.
const add_assistant_message = (
  messages: Anthropic.MessageParam[],
  message: Content | Anthropic.Message,
) => {
  messages.push({ role: "assistant", content: toContent(message) });
};

// ---------------------------------------------------------------------------
// Tools (from basic-tool.ts)
// ---------------------------------------------------------------------------

const tools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description:
      "Get the CURRENT weather observation for a place. This is not a forecast for future travel dates. " +
      "Only call it when the user asks about the weather. Always give the country, because place names " +
      "alone can match the wrong location. " +
      "The result is checked against the place you asked for; if no matching location is found it returns " +
      "weather: null with a reason, and you must then report the weather as unavailable.",
    input_schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The place name only, e.g. 'Keflavik' (no country).",
        },
        country: {
          type: "string",
          description: "The country the place is in, e.g. 'Iceland'.",
        },
      },
      required: ["location", "country"],
    },
  },
  {
    name: "get_todays_date",
    description: "Get today's date in YYYY-MM-DD format. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "add_time_period",
    description:
      "Add a period of time to a given date and return the new date in YYYY-MM-DD format. Use a negative amount to go back in time. To count from today, first call get_todays_date.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "The starting date in YYYY-MM-DD format",
        },
        amount: {
          type: "integer",
          description: "Number of units to add; negative to subtract",
        },
        unit: {
          type: "string",
          enum: ["days", "weeks", "months", "years"],
          description: "The unit of time for the amount",
        },
      },
      required: ["date", "amount", "unit"],
    },
  },
];

const runTool = async (name: string, input: unknown): Promise<string> => {
  switch (name) {
    case "get_weather": {
      const { location, country } = input as {
        location: string;
        country: string;
      };
      return JSON.stringify(await getWeather(location, country));
    }
    case "get_todays_date":
      return new Date().toISOString().slice(0, 10);
    case "add_time_period": {
      const { date, amount, unit } = input as {
        date: string;
        amount: number;
        unit: TimePeriod;
      };
      return addTimePeriod(new Date(date), amount, unit)
        .toISOString()
        .slice(0, 10);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const runTools = async (
  message: Anthropic.Message,
): Promise<Anthropic.ToolResultBlockParam[]> => {
  const toolUseBlocks = message.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  return Promise.all(
    toolUseBlocks.map(async (block) => {
      console.log(`[tool] ${block.name}(${JSON.stringify(block.input)})`);
      try {
        const output = await runTool(block.name, block.input);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: typeof output === "string" ? output : JSON.stringify(output),
          is_error: false,
        };
      } catch (err) {
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: String(err),
          is_error: true,
        };
      }
    }),
  );
};

// ---------------------------------------------------------------------------
// Input guardrail
// ---------------------------------------------------------------------------

// Text-only record of the chat (user and assistant messages) for the guardrail
const transcript: Turn[] = [];

// Structured outputs (output_config.format) constrain the cheap model's reply to
// this schema. It is written in Zod here, and parse() returns it typed.
const VerdictSchema = z.object({
  label: z.enum(["ON_TOPIC", "OFF_TOPIC"]),
  reason: z.string().describe("One short sentence."),
});

type Verdict = { allowed: boolean; reason: string };

// `turns` is the conversation so far, so short follow-ups are judged in context
const checkInput = async (text: string, turns: Turn[]): Promise<Verdict> => {
  try {
    const response = await client.messages.parse({
      model: guardrailModel,
      max_tokens: 200,
      system: inputGuardrailSystemPrompt,
      // Conversation and new message are wrapped in tags so they are treated as data
      messages: [{ role: "user", content: buildGuardrailInput(turns, text) }],
      output_config: { format: zodOutputFormat(VerdictSchema) },
    });
    // null if the reply was cut off or refused, so it fails closed below
    if (!response.parsed_output) {
      throw new Error(`no verdict returned (${response.stop_reason})`);
    }
    const { label, reason } = response.parsed_output;
    return { allowed: label === "ON_TOPIC", reason };
  } catch (err) {
    // Fail closed: if the guardrail itself breaks, don't let the input through
    return { allowed: false, reason: `guardrail error: ${String(err)}` };
  }
};

/** Runs the guardrail, telling the user why if the input is blocked. */
const passesGuardrail = async (text: string): Promise<boolean> => {
  const verdict = await checkInput(text, transcript);
  if (!verdict.allowed) console.warn(`\n[blocked] ${verdict.reason}\n`);
  return verdict.allowed;
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

const chat = async (messages: Anthropic.MessageParam[]) => {
  return client.messages.create({
    model: model,
    max_tokens: 4000,
    messages,
    tools,
    // On Claude 5 models `display` defaults to "omitted" (empty thinking text),
    // so opt in to summaries to be able to show the reasoning.
    thinking: { type: "adaptive", display: "summarized" },
    system: basicTravelSystemPrompt,
  });
};

// Summarized reasoning lives in `thinking` blocks. Empty blocks are normal (the
// model may skip thinking, or progress-update blocks may carry no text), so skip them.
const getThinking = (message: Anthropic.Message) =>
  message.content
    .flatMap((b) => (b.type === "thinking" && b.thinking ? [b.thinking] : []))
    .join("\n\n");

/**
 * Sends the conversation and keeps going while the model asks for tools: each
 * tool call is run and its result sent back, until the model gives a final
 * reply. Every message is added to `messages` as it happens.
 */
const runTurn = async (messages: Anthropic.MessageParam[]) => {
  while (true) {
    const response = await chat(messages);
    add_assistant_message(messages, response);

    const thinking = getThinking(response);
    if (thinking) console.log(`\n[thinking] ${thinking}\n`);

    if (response.stop_reason !== "tool_use") {
      return response;
    }

    add_user_message(messages, await runTools(response));
  }
};

// With thinking enabled, content[0] is usually a thinking block, so find the text block
const getText = (message: Anthropic.Message) => {
  const block = message.content.find((b) => b.type === "text");
  return block?.type === "text" ? block.text : "";
};

// Explanations for stop reasons other than a normal finish ("end_turn")
const EARLY_STOP_REASONS: Record<string, string> = {
  max_tokens: "the reply hit the max_tokens limit and was cut off",
  refusal: "the model declined to answer",
  pause_turn: "the turn was paused and is not complete",
  model_context_window_exceeded: "the conversation is too long for the model",
};

// NOTE: Conversation state. The Messages API is stateless, so the history lives
// here and is resent in full on every request. OpenAI offers this same pattern
// (see src/openai/basic-chat-with-tools.ts) plus an optional server-side store
// (Conversations API, see basic-chat-with-tools-conversation.ts). Anthropic has
// no drop-in equivalent on the Messages API; its closest match is Managed
// Agents sessions, which is a different abstraction (agent + environment +
// event stream), so it is not demonstrated here.
const messages: Anthropic.MessageParam[] = [];

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  while (true) {
    const first = await askHolidayPrompt(rl);
    if (await passesGuardrail(first)) {
      add_user_message(messages, first);
      transcript.push({ role: "user", text: first });
      break;
    }
  }

  while (true) {
    const response = await runTurn(messages);
    console.log(`\n${getText(response)}\n`);
    transcript.push({ role: "assistant", text: getText(response) });

    const { stop_reason } = response;
    if (stop_reason !== "end_turn") {
      const why = EARLY_STOP_REASONS[stop_reason ?? ""] ?? "unexpected stop";
      console.warn(`[stopped early: ${stop_reason ?? "unknown"}] ${why}\n`);
    }

    // Press return on an empty line to exit
    // Keep asking until the follow-up passes the guardrail (or the user exits)
    let followUp = "";
    while (true) {
      followUp = (await rl.question("Follow-up (return to exit): ")).trim();
      if (!followUp || (await passesGuardrail(followUp))) break;
    }
    if (!followUp) break;
    add_user_message(messages, followUp);
    transcript.push({ role: "user", text: followUp });
  }
} finally {
  rl.close();
}
