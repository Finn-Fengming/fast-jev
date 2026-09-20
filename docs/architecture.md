# fast-jev architecture

The decision contract is independent of the model. Version 0.1 implements two transports and three answer types, with no runtime dependencies or training step.

```text
CLI / JavaScript decide(request, options)
              |
  validate input -> build prompt + JSON Schema
              |
           runModel
          /        \
     local agy     OpenAI-compatible Chat Completions
          \        /
     strict local result validation
              |
  restore input order -> apply abstention threshold
              |
    JSON / text / ranked or filtered items
```

## Contracts

`state` is JSON; `questions` contains 1–100 questions with unique IDs. A question is `choice`, `boolean`, or `score`. Choice values must be exact members of the supplied set; score values must lie in the requested numeric range. Questions and state together are limited to 256 KiB of normalized UTF-8 JSON. Each provider call is independent. A batch is one request containing several questions; outputs are not claimed to be statistically independent or evaluated in parallel inside the model.

The provider returns `{ data, model, provider, usage, backendDurationMs }`. The local decision layer validates the complete result before returning any decisions. One invalid answer fails the whole batch: callers never receive a partial success disguised as a complete response. No repair calls, retries, provider switches, or model substitutions happen automatically.

`confidence` is a model's self-reported support for its answer. It is not a choice probability distribution, the probability of `true`, or an empirically calibrated correctness probability. Scores express the requested rubric, separately from confidence. Below an explicitly supplied `minConfidence`, the returned value becomes `null` and status becomes `abstained`. The default threshold is zero. Calibration and business-specific thresholds require labeled evaluation data.

## agy transport

Each request starts the configured executable with an argument array and `shell: false`, using a temporary working directory. The prompt is sent through a single stdin stream event, and the JSON Schema lives in a temporary file. This avoids shell interpolation, long prompt arguments, and accidental loading of the caller's repository context. Temporary files are removed when the process settles.

The adapter uses native `--mode plan`, `--sandbox`, and `--disable-slash-commands`, then consumes exactly one successful terminal result and its `structured_output`. It bounds elapsed time and output size, handles cancellation, and terminates the process group on POSIX systems. On Windows, process cancellation targets the direct child; native Windows AGY execution has not been verified in this project.

**These flags do not create a tool-free inference API.** AGY still owns authentication, global rules, configured integrations, histories, logs, and its permission implementation. A temporary working directory is not OS isolation. The wrapper does not rewrite the user's global settings or bypass permission checks. Use the direct compatible transport when the absence of local agent tools is required.

The default AGY model is `gemini-3.8-flash-low`, verified in the installed model listing on 2026-09-20. No separate effort flag is sent by default. Explicit effort must agree with the selected AGY model's suffix; changing to another model requires an explicit configuration choice.

## OpenAI-compatible transport

The adapter sends one non-streaming `POST` to `<baseUrl>/chat/completions`; a base URL already ending in `/chat/completions` is accepted. It sends no tools. Credentials are supplied in a Bearer header when configured. Redirects are refused; endpoint URLs may not contain credentials, query parameters, or fragments. Upstream HTTP error bodies are not echoed, because gateways may include secrets or submitted input in them.

Three explicit modes cover different implementations:

| Mode | Request | Local validation |
| --- | --- | --- |
| `json_schema` (default) | Strict named `response_format.json_schema` | Always |
| `json_object` | JSON mode plus schema instructions | Always |
| `text` | Schema instructions, no `response_format` | Always |

Compatibility means this subset of the Chat Completions protocol, not every endpoint called “OpenAI-compatible.” A completed response must have `finish_reason: "stop"`, string `message.content` containing JSON, and no refusal or tool call. Truncated responses and malformed or incomplete decisions fail. Response bodies are limited to 2 MiB; timeouts cover response reading as well as initial connection. Optional `--max-tokens` sends the compatible `max_tokens` field; omit it on providers that do not support that field. Effort is omitted unless requested.

## Efficiency and observability

The intended savings come from one call for shared context, short structured answers, optional explanations, and avoiding agent tool work. There is no implicit disk cache or persistent cross-request conversation. AGY process startup and its harness may dominate short decisions. Measure the end-to-end cost before adding persistence or concurrency.

Successful output includes requested model, provider, elapsed decision-layer time, backend duration when available, and raw provider-reported token usage. AGY's backend duration comes from its result envelope; compatible backend duration is measured by the HTTP adapter. These durations have different boundaries and must not be treated as identical model inference time. Unknown usage is `null`; fast-jev does not invent prices or bills.

The CLI reads explicit context files into the request; their contents go to the selected model provider. `--dry-run` prints that request and prompt locally. fast-jev has no decision-history store, but the chosen provider may retain logs according to its settings.

## Extension point

Add a transport to `src/providers.mjs` that accepts `prompt`, `schema`, `model`, `timeoutMs`, and `signal`, and returns the shared backend contract. Keep protocol parsing in the transport and semantic validation in `src/decision.mjs`. Add fixture tests for failures and cancellation before exposing a new CLI provider. MCP, calibrated probabilities, persistent AGY sessions, and business-specific quality evaluation remain future work.

## Protocol references

- [AGY headless input, output, schemas and model selection](https://antigravity.google/docs/cli/headless/)
- [AGY permission behavior](https://antigravity.google/docs/permissions?tab=cli)
- [OpenAI structured output formats](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)
- [Chat Completions request and response](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Jev research and evidence boundaries](research-jev.md)
