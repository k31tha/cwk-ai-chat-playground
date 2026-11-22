import dotenv from "dotenv";
import { createInterface } from "node:readline/promises";
import OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import { basicTravelSystemPrompt } from "../common/prompt-ref.js";
import { model } from "./config.js";

dotenv.config();

const client = new OpenAI();

// History is kept here and resent in full each turn (no previous_response_id
// or Conversations API), so `store: false` keeps the server stateless.
const history: ResponseInput = [];
const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  while (true) {
    const input = (await rl.question("You (return to exit): ")).trim();
    if (!input) break;
    history.push({ role: "user", content: input });

    const response = await client.responses.create({
      model,
      instructions: basicTravelSystemPrompt,
      input: history,
      store: false,
    });

    history.push({ role: "assistant", content: response.output_text });

    console.log(`\n${response.output_text}\n`);
  }
} finally {
  rl.close();
}
