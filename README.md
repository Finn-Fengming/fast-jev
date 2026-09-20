# fast-jev

[English](README.md) · [简体中文](README.zh-CN.md)

Small, typed AI decisions from your terminal. Use your existing **agy** login or an **OpenAI-compatible API**—no model training, no runtime dependencies.

```sh
fjev choose "What should we do next?" \
  --option ship --option investigate \
  --context "The release tests failed." --text
```

Inspired by Jev's closed-decision pattern. This is an independent wrapper, not the Jev model or a TypeSafe API client. Confidence is **self-reported and uncalibrated**. See the [research report](docs/research-jev.md) for the evidence and design tradeoffs.

## Install

Requires **Node.js 22+** (includes npm). Install the public GitHub Release package directly; no source checkout or npm account is needed:

```sh
npm install -g https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz
fjev --help
```

Or try it without a global installation:

```sh
npx --yes --package=https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz fjev --help
```

`fast-jev` and `fjev` are the same command. [Download the package](https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz) · [SHA-256 checksums](https://github.com/Finn-Fengming/fast-jev/releases/latest/download/SHA256SUMS) · [Pinned versions and offline installation](docs/distribution.md).

Distribution currently uses **GitHub Releases**; `npm install -g fast-jev` is not a published registry installation path. Developers can still use `npm install -g .` from a checkout.

## Pick a backend

### agy: the default

Have `agy` installed, signed in, and working on this machine. No additional key, config file, or `init` command is needed.

```sh
fjev doctor
fjev check "Did the health check succeed?" --context "HTTP 200 OK"
```

The default model is `gemini-3.8-flash-low`, an identifier listed by the inspected local `agy models`. Use `--model ID` or `--agy-bin /path/to/agy` to override. Model availability depends on your agy installation and account.

agy runs in a temporary working directory, receives the prompt through stdin, and uses a temporary schema file. The adapter enables agy's plan mode and sandbox and disables slash commands. It reuses your existing login and user-level settings; the temporary directory is not a separate profile or a guarantee that tools are unavailable. Permissions, authentication, and logs remain under your local agy's control.

### OpenAI-compatible API

Choose the backend and model explicitly:

```sh
export OPENAI_API_KEY='your-key'
fjev check "Did the health check succeed?" --context "HTTP 200 OK" \
  --provider openai \
  --base-url https://gateway.example/v1 \
  --model your-model-id
```

`--base-url` accepts an API root such as `/v1` or the full `/chat/completions` URL. Its default is `https://api.openai.com/v1`. Local endpoints that do not require authentication may omit the key.

Output modes are explicit:

| `--response-format` | Behavior |
| --- | --- |
| `json_schema` (default) | Request strict JSON Schema output |
| `json_object` | Request JSON mode |
| `text` | Omit `response_format`; request JSON in the prompt |

Compatible servers differ. Select `json_object` or `text` if your endpoint does not support strict schema. Every mode uses the same local validation. **fast-jev does not automatically downgrade modes, switch backends, or retry.** `--effort` and `--max-tokens` are optional; use them only if your backend supports the requested values.

## Commands

```sh
# Choose one option; classify is an alias
fjev choose "Support queue?" --option billing --option technical --option other \
  --context "I was charged twice."
echo "I cannot sign in" | fjev classify "Support queue?" \
  --options '["billing","technical","other"]'

# Boolean; a valid false result is still a successful command
fjev check "Is this a bug report?" --file ticket.txt

# Numeric score; default range is 0–1
fjev score "Urgency: 0 means routine, 10 means an active outage." \
  --min 0 --max 10 --context "Checkout is unavailable." --explain

# Rank descending or keep matching items from a JSON array
printf '%s\n' '[{"name":"Cache reads","effort_days":2},{"name":"Rewrite","effort_days":60}]' | fjev rank "Expected benefit relative to effort" --top 1
printf '%s\n' '[{"name":"Cache reads","effort_days":2},{"name":"Rewrite","effort_days":60}]' | fjev filter "Can this be completed within two days?"

# Several typed questions in one model call; batch is an alias
printf '%s\n' '{"state":"HTTP 200 OK","questions":[{"id":"healthy","type":"boolean","prompt":"Did the request succeed?"}]}' | fjev batch --pretty

# Configuration and diagnostics
fjev config --pretty
fjev doctor
fjev doctor --live
```

For single decisions, supply `--context`, `--file`, or piped text. `--context` and `--file` are combined; piped text is read only when neither is supplied. `rank` and `filter` take a JSON array; `decide` takes a request object. These JSON commands accept `--input FILE`, `--input -`, or piped JSON. Optional `--context`/`--file` on `rank` and `filter` add shared context.

`rank`, `filter`, and `decide` each bundle their questions into **one call**, rather than one call per item. That does not guarantee independent or parallel model inference. Requests are limited to **100 questions/items** and **256 KiB** of serialized input; a choice supports **2–100 distinct strings**. A malformed response fails the whole call.

## Results and abstention

JSON is the default. `--pretty` indents it; `--text` prints only the value (or a JSON array of retained items for `rank`/`filter`). `--explain` adds a short reason.

Example output shape—illustrative, not a benchmark:

```json
{
  "command": "choose",
  "result": {
    "id": "decision",
    "type": "choice",
    "value": "investigate",
    "confidence": 0.91,
    "status": "ok"
  },
  "meta": {
    "provider": "agy",
    "model": "gemini-3.8-flash-low",
    "elapsed_ms": 1500,
    "backend_duration_ms": null,
    "usage": null,
    "confidence_kind": "self_reported",
    "calibrated": false
  }
}
```

`score.value` measures the requested dimension; `confidence` expresses the model's support for its answer. They are separate. This version returns direct choices, booleans, and bounded numeric scores; it does **not** return Jev probability distributions or reproduce Jev's Score/Noul semantics.

```sh
fjev choose "Next step?" --option ship --option investigate \
  --context "The test results are missing." --min-confidence 0.8
```

Below the threshold, `value` becomes `null`, `status` becomes `abstained`, and the command exits **4**. The default threshold is 0. Rank/filter omit abstained items from `result` and report them separately in `abstained`; any abstention still produces exit 4. A threshold is a routing rule, not a guarantee of accuracy.

| Exit code | Meaning |
| --- | --- |
| `0` | Valid result, including boolean `false` |
| `1` | Backend or output error |
| `2` | Invalid input or configuration |
| `4` | At least one abstention |
| `124` | Timeout |
| `130` | Canceled |

Results go to stdout; errors are JSON on stderr. The default backend timeout is **60 seconds**; override with `--timeout MS`.

## Configuration

Configuration is optional. The default path is `$XDG_CONFIG_HOME/fast-jev/config.json`, or `~/.config/fast-jev/config.json` when XDG is unset. Use `--config PATH` or `FAST_JEV_CONFIG` for another file. Save [this config template](https://raw.githubusercontent.com/Finn-Fengming/fast-jev/main/examples/config.json) as `config.json`:

```sh
fjev config --config config.json --pretty
fjev check "Is it ready?" --context "All required checks passed." \
  --config config.json --provider openai
```

Precedence: **flags → environment → selected provider's config → defaults**. `provider` and `timeoutMs` are top-level settings; backend-specific fields live under `agy` or `openai`. API keys stay in environment variables, not the config file. `config` reports resolved settings without printing the key.

| Environment variable | Purpose |
| --- | --- |
| `FAST_JEV_PROVIDER` | `agy` or `openai` |
| `FAST_JEV_MODEL` | Override the selected backend's model |
| `FAST_JEV_TIMEOUT_MS` | Backend timeout in milliseconds |
| `FAST_JEV_AGY_BIN` | agy executable |
| `FAST_JEV_EFFORT` | Optional `low`, `medium`, or `high` |
| `OPENAI_BASE_URL` | Compatible API root or completion URL |
| `OPENAI_API_KEY` | Default compatible API credential |
| `FAST_JEV_API_KEY` | Credential override, ahead of the configured key variable |
| `FAST_JEV_RESPONSE_FORMAT` | `json_schema`, `json_object`, or `text` |
| `FAST_JEV_CONFIG` | Explicit config file path |

`openai.apiKeyEnv` can select a different credential variable. `--max-tokens` / `openai.maxTokens` map to the compatible endpoint's `max_tokens`. `--effort` maps to agy's effort option or the API's `reasoning_effort` and is omitted unless configured. Avoid conflicting model suffixes and effort settings, such as a `-medium` agy model with `--effort low`.

## JavaScript API

Install in your project:

```sh
npm install https://github.com/Finn-Fengming/fast-jev/releases/latest/download/fast-jev.tgz
```

```js
import { decide } from 'fast-jev';

const output = await decide({
  state: 'The release tests failed.',
  questions: [
    { id: 'action', type: 'choice', prompt: 'Next step?', options: ['ship', 'investigate'] },
    { id: 'ready', type: 'boolean', prompt: 'Did the tests pass?' },
    { id: 'risk', type: 'score', prompt: 'Risk: 0 is low, 10 is high.', min: 0, max: 10 }
  ]
}, { provider: 'agy', minConfidence: 0.8 });

console.log(output.results);
```

The exports also include `buildDecision`, `validateRequest`, and `validateOutput`. The API does not automatically load CLI config/environment settings: for HTTP, pass `{ provider: 'openai', model, baseUrl, apiKey: process.env.OPENAI_API_KEY }`. Pass an `AbortSignal` as `signal` to cancel.

## Inspect and test

```sh
# Show the request, prompt, and schema without calling a model
fjev check "HTTP OK?" --context "HTTP 200 OK" --dry-run --pretty

# The following checks are for a source checkout
npm test
npm run check
npm run package
npm run test:package
```

`--dry-run` includes your input in its output. `doctor` checks setup; agy's model listing may contact its service. It does not prove inference works. `doctor --live` makes one real test decision and may incur provider usage. Tests use local fixtures/mocks; they do not establish model accuracy or production latency. All 169 local tests passed in a serial run; [CI](https://github.com/Finn-Fengming/fast-jev/actions/workflows/ci.yml) runs on Linux/macOS with Node.js 22/24.

For a small, real-call timing check:

```sh
npm run benchmark -- --provider agy --runs 3
npm run benchmark -- --provider openai --model your-model-id --runs 3
```

The script reports samples, failures, and successful-call p50/p95. Each run makes a real request; three runs are only a smoke check, not a reliable tail-latency estimate, accuracy study, or calibration benchmark.

| Symptom | Next step |
| --- | --- |
| agy missing or required flags unavailable | Check `agy --version`, update agy, or set `--agy-bin` |
| API HTTP 400 | Check the model and explicitly select a supported response format |
| Timeout | Check backend connectivity; increase `--timeout` only when appropriate |

A [live check on 2026-09-20](experiments/results/agy-recovered-preflight-20260920/report.json) succeeded with agy 1.2.7 and `gemini-3.8-flash-low`: the decision took 20,956 ms, while the backend reported 7,293 ms. These have different timing boundaries; one check is not a latency distribution.

## Reproducible experiments

**Live AGY / Gemini versus native OpenRouter Jev (2026-09-20).** Models are `gemini-3.8-flash-low` and `typesafe/jev-1.13`. Both use a 60 s deadline, batch-of-eight before singleton, one measured pass, serial alternating AB/BA order and no application retries. Each backend/mode plans **64 cases**; warmups are excluded. Run status: `completed_with_errors`.

Jev had higher end-to-end accuracy and lower successful-request latency in this run. All successful AGY outputs were correct; failed calls reduced its end-to-end accuracy. Jev uses a benchmark-only native Decisions API adapter; the production CLI's compatible backend uses Chat Completions.

| Mode | Backend | Correct / attempted cases | Case coverage | Failed / attempted requests | Successful-request p50 / p95 (s) |
| --- | --- | ---: | ---: | ---: | ---: |
| Singleton | AGY / Gemini | 59/64 (92.19%) | 64/64 | 5/64 | 13.447 / 44.665 |
| Singleton | OpenRouter Jev | 64/64 (100.00%) | 64/64 | 0/64 | 0.318 / 0.458 |
| Batch of 8 | AGY / Gemini | 48/64 (75.00%) | 64/64 | 2/8 | 12.892 / 44.182 |
| Batch of 8 | OpenRouter Jev | 63/64 (98.44%) | 64/64 | 0/8 | 0.324 / 0.462 |

End-to-end accuracy includes backend failures. Coverage is attempted / 64; unrun cases are not predictions. Conditional accuracy among successful responses is: singleton AGY 59/59 (100.00%), Jev 64/64 (100.00%); batch AGY 48/48 (100.00%), Jev 63/64 (98.44%). Successful-request percentiles exclude failure times; see the [raw report](experiments/results/agy-jev-openrouter-60s-test-20260920/comparison.md) for failures, all-attempt timings and coverage.

Choice/boolean use exact match; score correctness allows absolute error **≤ 0.5**. Native Jev scores stay continuous, without rounding. Score metrics below cover returned score answers, with MAE restricted to valid values; backend errors remain in the main table's denominator.

| Mode | Backend | Score MAE | Score exact match | Valid scores |
| --- | --- | ---: | ---: | ---: |
| Singleton | AGY / Gemini | 0.0000 | 100.00% | 15 |
| Singleton | OpenRouter Jev | 0.0075 | 56.25% | 16 |
| Batch of 8 | AGY / Gemini | 0.0000 | 100.00% | 15 |
| Batch of 8 | OpenRouter Jev | 0.0569 | 68.75% | 16 |

Mean successful batch amortization: **AGY 2823.74 ms/case; Jev 45.26 ms/case**. This is not individual response latency: each case waits for the complete batch. Timings include fresh AGY process startup or Jev's Node fetch transport, plus request construction, parsing and validation; they do not isolate model compute. Batch mode has at most eight request samples; p95 of eight samples is their maximum.

**The initial 30 s attempt remains visible:** [its report](experiments/results/agy-jev-openrouter-test-20260920/comparison.md) covers 15/64 singleton cases per backend: AGY 8/15 correct with seven timeouts, Jev 15/15 correct. Three consecutive AGY timeouts stopped measurement; each backend's remaining 49 singleton cases and all batch cases were unrun. The 60 s deadline and batch-first order were explicitly selected after observing those failures. No question, label or model prompt changed, and the best predictions were not combined across attempts.

This small synthetic set has already been observed. Labels are AI-assisted and rule-derived, without independent human annotation. One pass does not establish production accuracy or stable latency; native Jev probabilities are not compared to AGY's self-reported confidence. [Comparison guide](experiments/COMPARISON.md) · [Protocol](experiments/protocols/agy-jev-openrouter-60s-20260920.md) · [Results and analysis](experiments/results/agy-jev-openrouter-60s-test-20260920/analysis.md) · [JSON](experiments/results/agy-jev-openrouter-60s-test-20260920/comparison.json).

Reproduction requires working local agy and `OPENAI_API_KEY` configured for OpenRouter. Run from a source checkout; the installation package excludes experiment scripts. Every output directory must be new:

```sh
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 \
  --out experiments/results/my-comparison
node experiments/compare-report.mjs experiments/results/my-comparison
```

Add `--plan` to the first command for a no-inference plan. The second command only verifies saved answers, request hashes, scoring and paired order. [Historical AGY, external Jev and local overhead experiments](experiments/README.md#历史实验索引) are retained separately.

## Limits

This wrapper validates structure, allowed values, and ranges; it cannot guarantee correct judgments or resist every prompt injection. Keep exact arithmetic in code and evaluate thresholds on your own labeled examples. Inputs are sent to the selected backend; agy reuses its own authentication and service routing. No latency, cost, or calibration claims are made without measurements.

Read the [full Jev research and validation plan](docs/research-jev.md) for the distinction between the original decision model and this no-training wrapper.

Implementation details: [architecture](docs/architecture.md) · [verification record](docs/validation.md).

[Distribution](docs/distribution.md) · [Privacy and package contents](docs/security.md).
