# cwk-ai-chat-playground

A small TypeScript playground for comparing chat messaging with the **Anthropic SDK** (`@anthropic-ai/sdk`) and the **OpenAI SDK** (`openai`). Both sides build the same thing, a command-line travel assistant, so the differences between the two APIs are easy to see side by side.

## What it covers

| Topic | Anthropic (`src/anthropic/`) | OpenAI (`src/openai/`) |
|---|---|---|
| Basic multi-turn chat | `basic-chat.ts` (`messages.create`) | `basic-chat.ts` (`responses.create`) |
| Tool / function calling | `basic-chat-with-tools.ts` | `basic-chat-with-tools.ts` |
| Server-side conversation state | not demonstrated (see note below) | `basic-chat-with-tools-conversation.ts` (Conversations API) |

Each example is an interactive loop in the terminal: you chat, and the model can call tools for the current weather, today's date and date arithmetic.

Some of the differences the examples show:

- **System prompt:** a top-level `system` parameter (Anthropic) versus `instructions` (OpenAI).
- **Message shape:** role-based messages with typed content blocks (Anthropic) versus a flat list of typed items (OpenAI Responses API).
- **Tool loop:** `stop_reason === "tool_use"` with `tool_result` blocks (Anthropic) versus `function_call` items answered with `function_call_output` (OpenAI).
- **Reasoning:** adaptive thinking blocks (Anthropic) versus encrypted reasoning items (OpenAI), both of which must be sent back on the next request.
- **State:** both APIs are stateless by default, so the history is resent each turn. OpenAI also offers an optional server-side store. Anthropic's closest equivalent is Managed Agents sessions, a different abstraction that isn't covered here.

## Project layout

```
src/
  anthropic/   Anthropic SDK examples (+ config.ts with the model name)
  openai/      OpenAI SDK examples (+ config.ts with the model name)
  common/      Shared system prompt, example prompts and tool helpers
```

## Getting started

Requires Node.js and [pnpm](https://pnpm.io/).

```bash
pnpm install
cp .env.example .env   # then add your API keys
```

Environment variables (see `.env.example`):

- `ANTHROPIC_API_KEY` for the Anthropic examples
- `OPENAI_API_KEY` for the OpenAI examples
- `WEATHER_API_KEY` (optional) for real weather data via OpenWeatherMap

## Running the examples

```bash
pnpm tsx src/anthropic/basic-chat.ts
pnpm tsx src/anthropic/basic-chat-with-tools.ts
pnpm tsx src/openai/basic-chat.ts
pnpm tsx src/openai/basic-chat-with-tools.ts
pnpm tsx src/openai/basic-chat-with-tools-conversation.ts

# Variants that also print the model's reasoning summary
pnpm tsx src/anthropic/basic-chat-with-tools-reasoning.ts
pnpm tsx src/openai/basic-chat-with-tools-conversation-reasoning.ts
```

Press return on an empty line to exit. Model names are set in each folder's `config.ts`.
