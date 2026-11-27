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

## Learning path

New to this? You do not need everything in the repo. Work through it in this order and stop whenever you have what you need. The numbers of lines are approximate.

| Step | Read and run | You learn | Level |
|---|---|---|---|
| 1. Start here | `basic-chat.ts` in each folder (about 35 lines) | Sending messages, the system prompt, and why the history is resent every turn | Beginner |
| 2. Tools | `basic-chat-with-tools.ts` in each folder (about 210 to 235 lines) | Describing a tool to the model, and the loop that runs it and sends the result back | Beginner to intermediate: the biggest jump in the core path |
| 3. State and reasoning (optional) | `basic-chat-with-tools-conversation.ts` (OpenAI), and the two `-reasoning` variants | Server-side conversation state, and showing the model's reasoning summary | Intermediate |
| 4. Safety checks (optional) | `src/anthropic/input-guardrail.ts` or `src/openai/input-guardrail.ts` (about 55 to 60 lines), then `src/utils/show-input-moderation.ts` | Checking a message with a cheap model before the main model sees it, and what OpenAI's Moderation API returns | Intermediate |
| 5. Evaluating (advanced, skip on a first pass) | the generators and evaluators in `src/utils/`, and `data/` | Generating test cases, scoring a guardrail, and repeat runs | Advanced |

Tips:

- **Step 2:** read the file in this order: the tool definitions, then `runTool`, then the chat loop at the bottom.
- **Step 4:** the `basic-chat-add-input-guardrail.ts` and `basic-chat-add-input-moderation.ts` files are 250 to 310 lines because each is a copy of an earlier example with a check added. To see only what changed, diff them against the file they copy, for example `diff src/anthropic/basic-chat-with-tools-reasoning.ts src/anthropic/basic-chat-add-input-guardrail.ts` (the OpenAI guardrail file copies `basic-chat-with-tools-conversation-reasoning.ts`). The moderation examples run OpenAI moderation and then the guardrail, so they need both API keys.
- **Step 5:** the generators and evaluators in `src/utils/` (everything except `show-input-moderation.ts`) and the files in `data/` are not needed for steps 1 to 4.

## Project layout

```
src/
  anthropic/   Anthropic SDK examples (+ config.ts with the model name)
  openai/      OpenAI SDK examples (+ config.ts with the model name)
  common/      Shared system prompt, example prompts and tool helpers
  utils/       Test-case generators and evaluators for the guardrail and moderation checks (advanced)
data/          Test-case files for those evaluators; saved results go in data/results/ (git-ignored)
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
pnpm guardrail:generate --count 30 --out my-cases

# Run a cases file through the guardrail. A bare name is read from data/; -s a = Anthropic, -s o = OpenAI, no flag = both
pnpm guardrail:eval my-cases -s a

# Run every case 3 times; the summary lists cases whose verdict changed between runs as unstable
pnpm guardrail:eval my-cases --repeat 3

# 12 cases written by Claude for the programming-help rule: 6 travel-flavoured coding requests (expected OFF_TOPIC) and 6 near-miss travel questions (expected ON_TOPIC)
pnpm guardrail:eval guardrail-cases-code --repeat 3

# 40 generated cases for the same rule (half coding requests, half travel questions that mention technology)
pnpm tsx src/utils/generate-code-request-cases.ts --count 40 --out my-code-cases
pnpm guardrail:eval guardrail-cases-code-generated --repeat 3
```

Give options straight after the script name, as above. Do not add npm's `--` separator (`pnpm guardrail:eval -- my-cases`): pnpm passes the `--` on to the script, which then ignores the flags that follow it.

Options of `pnpm guardrail:eval`:

| Option | Default | What it does |
|---|---|---|
| `<cases-file>` (first argument) | `guardrail-cases` | Cases JSON to run. A bare name is read from `data/`; a path is used as given |
| `--sdk`, `-s` | both | `a` = Anthropic, `o` = OpenAI |
| `--repeat`, `-r` | `1` | Run every case this many times. Each run is its own result with a `run` number, the summary counts runs, and cases whose runs disagree are listed as `unstable` |
| `--no-history` | off | Ignore the earlier turns of each case and judge the last message alone. Follow-up cases like "what about May?" should now fail, which shows the conversation context is doing the work |
| `--concurrency`, `-c` | `4` | How many calls to make at once |

Each result is logged as a JSON line (`sdk`, `model`, `prompt`, `expected`, `actual`, `pass`, plus `run` when `--repeat` is above 1) and the full results are saved in `data/results/` (git-ignored). `data/guardrail-cases.json` is a committed sample.

## Comparing moderation with the guardrail

OpenAI's Moderation API flags harmful content (it is free and fast); the guardrail checks topic.

```bash
# See the raw Moderation API request and response for a message (or three built-in samples)
pnpm tsx src/utils/show-input-moderation.ts "some message"

# Compare moderation, each guardrail, and moderation + guardrail on 27 cases, one at a time.
# Works with moderation and guardrail cases files; --moderation-only skips the guardrails
pnpm moderation:eval
pnpm moderation:eval guardrail-cases-50 -s o

# Run every case 3 times to see which verdicts are stable (an LLM guardrail can answer differently on the same input)
pnpm moderation:eval --repeat 3

# Judge the guardrails without the conversation history (moderation never uses it)
pnpm moderation:eval guardrail-cases-50 --no-history

# Generate more cases across harmless, off-topic, injection, borderline and harmful categories (default 27)
pnpm moderation:generate --count 90 --out my-moderation-cases
```

Options of `pnpm moderation:eval`:

| Option | Default | What it does |
|---|---|---|
| `<cases-file>` (first argument) | `moderation-cases` | Cases JSON to run (moderation or guardrail cases). A bare name is read from `data/`; a path is used as given |
| `--sdk`, `-s` | both | Which guardrail to compare with: `a` = Anthropic, `o` = OpenAI |
| `--moderation-only` | off | Skip the guardrails and run only moderation (free) |
| `--repeat`, `-r` | `1` | Run every case this many times; cases whose runs disagree are listed as `unstable` |
| `--no-history` | off | Judge the guardrails without the earlier turns of each case |

Cases run one at a time, so there is no concurrency option.

Each case prints three lines (the case, what was expected, each check's decision), then a short summary. `data/moderation-cases.json` (27 cases) is the committed default; `data/moderation-cases-90.json` is the larger set it was taken from. They contain short, non-graphic test inputs for a content classifier (insults, threats, self-harm statements, requests for erotica). Results are saved in `data/results/`.

Press return on an empty line to exit. Model names are set in each folder's `config.ts`.
