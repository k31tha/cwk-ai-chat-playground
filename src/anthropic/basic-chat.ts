import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { createInterface } from "node:readline/promises";
import { basicTravelSystemPrompt } from "../common/prompt-ref.js";
import { model } from "./config.js";

dotenv.config();

const client = new Anthropic();
const messages: Anthropic.MessageParam[] = [];
const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  while (true) {
    const input = (await rl.question("You (return to exit): ")).trim();
    if (!input) break;
    messages.push({ role: "user", content: input });

    const response = await client.messages.create({
      model: model,
      max_tokens: 4000,
      messages,
      system: basicTravelSystemPrompt,
    });
    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text") console.log(`\n${block.text}\n`);
    }
  }
} finally {
  rl.close();
}
