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

# Variants that check every user message with a cheap model first (input guardrail)
pnpm tsx src/anthropic/basic-chat-add-input-guardrail.ts
pnpm tsx src/openai/basic-chat-add-input-guardrail.ts

# Variants that run OpenAI moderation first, then the input guardrail (needs OPENAI_API_KEY too)
pnpm tsx src/anthropic/basic-chat-add-input-moderation.ts
pnpm tsx src/openai/basic-chat-add-input-moderation.ts
```

## Evaluating the input guardrail

```bash
# Generate N sample prompts with the label the guardrail should give (default 24, mixed categories)
pnpm guardrail:generate -- --count 30 --out my-cases

# Run a cases file through the guardrail. A bare name is read from data/; -s a = Anthropic, -s o = OpenAI, no flag = both
pnpm guardrail:eval -- my-cases -s a
```

Each result is logged as a JSON line (`sdk`, `model`, `prompt`, `expected`, `actual`, `pass`) and the full results are saved in `data/results/` (git-ignored). `data/guardrail-cases.json` is a committed sample.

## Comparing moderation with the guardrail

OpenAI's Moderation API flags harmful content (it is free and fast); the guardrail checks topic.

```bash
# See the raw Moderation API request and response for a message (or three built-in samples)
pnpm tsx src/utils/show-input-moderation.ts "some message"

# Compare moderation, each guardrail, and moderation + guardrail on 27 cases, one at a time.
# Works with moderation and guardrail cases files; --moderation-only skips the guardrails
pnpm moderation:eval
pnpm moderation:eval -- guardrail-cases-50 -s o

# Generate more cases across harmless, off-topic, injection, borderline and harmful categories (default 27)
pnpm moderation:generate -- --count 90 --out my-moderation-cases
```

Each case prints three lines (the case, what was expected, each check's decision), then a short summary. `data/moderation-cases.json` (27 cases) is the committed default; `data/moderation-cases-90.json` is the larger set it was taken from. They contain short, non-graphic test inputs for a content classifier (insults, threats, self-harm statements, requests for erotica). Results are saved in `data/results/`.

Press return on an empty line to exit. Model names are set in each folder's `config.ts`.
