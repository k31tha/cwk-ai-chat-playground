// Variant of basic-chat-with-tools-conversation-reasoning.ts that checks every user message
// (the holiday prompt and each follow-up) with OpenAI's MODERATION API before it
// reaches the main model. Flagged messages are rejected with the flagged
// categories and never enter the conversation history. Same shape as
// basic-chat-add-input-guardrail.ts so the two can be compared. Moderation
// checks for harmful content, not topic, so off-topic but harmless messages pass.
import dotenv from "dotenv";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import type {
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInput,
} from "openai/resources/responses/responses";
import { basicTravelSystemPrompt } from "../common/prompt-ref.js";
import {
  addTimePeriod,
  askHolidayPrompt,
  getWeather,
  type TimePeriod,
} from "../common/utils.js";
import { model } from "./config.js";
import { runInputModeration } from "./input-moderation.js";

// Load environment variables
dotenv.config();

const client = new OpenAI();

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const tools: FunctionTool[] = [
  {
    type: "function",
    name: "get_weather",
    description:
      "Get the CURRENT weather observation for a place. This is not a forecast for future travel dates. " +
      "Only call it when the user asks about the weather. Always give the country, because place names " +
      "alone can match the wrong location.",
    strict: true,
    parameters: {
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
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_todays_date",
    description: "Get today's date. Takes no arguments.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "add_time_period",
    description:
      "Add a period of time to a given date and return the new date. Use a negative amount to go back in time. To count from today, first call get_todays_date.",
    strict: true,
    parameters: {
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
      additionalProperties: false,
    },
  },
];

const runTool = async (name: string, args: unknown): Promise<string> => {
  switch (name) {
    case "get_weather": {
      const { location, country } = args as {
        location: string;
        country: string;
      };
      return JSON.stringify(await getWeather(location, country));
    }
    case "get_todays_date":
      return new Date().toISOString().slice(0, 10);
    case "add_time_period": {
      const { date, amount, unit } = args as {
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
  calls: ResponseFunctionToolCall[],
): Promise<ResponseInput> =>
  Promise.all(
    calls.map(async (call) => {
      console.log(`[tool] ${call.name}(${call.arguments})`);
      let output: string;
      try {
        output = await runTool(call.name, JSON.parse(call.arguments));
      } catch (err) {
        output = `Error: ${String(err)}`;
      }
      return {
        type: "function_call_output" as const,
        call_id: call.call_id,
        output,
      };
    }),
  );

// ---------------------------------------------------------------------------
// Input moderation
// ---------------------------------------------------------------------------

// Moderation looks at one message at a time, so unlike the guardrail it needs
// no record of the conversation. The call lives in ../openai/input-moderation.ts
// so the evaluation script can reuse it.

/** Runs moderation, telling the user why if the input is blocked. */
const passesModeration = async (text: string): Promise<boolean> => {
  try {
    const { flagged, reason } = await runInputModeration(text);
    if (!flagged) return true;
    console.warn(`
[blocked] ${reason}
`);
  } catch (err) {
    // Fail closed: if moderation itself breaks, don't let the input through
    console.warn(`
[blocked] moderation error: ${String(err)}
`);
  }
  return false;
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

// The conversation is stored by OpenAI (Conversations API). Every response
// created with `conversation: id` automatically appends its input and output
// items to it, so each request sends only the NEW items, not the full history.
const conversation = await client.conversations.create();

const chat = (input: ResponseInput): Promise<Response> =>
  client.responses.create({
    model,
    // Instructions are not carried over by the conversation, so send them each time
    instructions: basicTravelSystemPrompt,
    conversation: conversation.id,
    input,
    tools,
    // Raw reasoning is never exposed; ask for a summary of it instead
    reasoning: { summary: "auto" },
  });

// Summaries come back as `reasoning` items, each with a `summary` array of text parts
const getReasoningSummary = (response: Response): string =>
  response.output
    .flatMap((item) =>
      item.type === "reasoning" ? item.summary.map((s) => s.text) : [],
    )
    .filter(Boolean)
    .join("\n\n");

/**
 * Sends new input and keeps going while the model asks for tools: each tool
 * call is run and its output sent as the next input, until the model gives a
 * final reply.
 */
const runTurn = async (input: ResponseInput): Promise<Response> => {
  while (true) {
    const response = await chat(input);

    const summary = getReasoningSummary(response);
    if (summary) console.log(`\n[reasoning summary] ${summary}\n`);

    const calls = response.output.filter(
      (item): item is ResponseFunctionToolCall => item.type === "function_call",
    );
    if (calls.length === 0) return response;

    input = await runTools(calls);
  }
};

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  let first = "";
  while (true) {
    first = await askHolidayPrompt(rl);
    if (await passesModeration(first)) break;
  }
  let input: ResponseInput = [{ role: "user", content: first }];

  while (true) {
    const response = await runTurn(input);
    console.log(`\n${response.output_text}\n`);

    if (response.status !== "completed") {
      const reason = response.incomplete_details?.reason ?? "unknown";
      console.warn(`[stopped early: ${response.status}] ${reason}\n`);
    }

    // Press return on an empty line to exit
    // Keep asking until the follow-up passes moderation (or the user exits)
    let followUp = "";
    while (true) {
      followUp = (await rl.question("Follow-up (return to exit): ")).trim();
      if (!followUp || (await passesModeration(followUp))) break;
    }
    if (!followUp) break;
    input = [{ role: "user", content: followUp }];
  }
} finally {
  rl.close();
}
