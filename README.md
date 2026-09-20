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

`--dry-run` includes your input in its output. `doctor` checks setup; agy's model listing may contact its service. It does not prove inference works. `doctor --live` makes one real test decision and may incur provider usage. Tests use local fixtures/mocks; they do not establish model accuracy or production latency. All 130 local tests passed; the [CI](https://github.com/Finn-Fengming/fast-jev/actions/workflows/ci.yml) passed on Linux/macOS with Node.js 22/24.

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

The [experiment guide](experiments/README.md) includes a frozen 96-case English/Chinese diagnostic suite (32 dev / 64 test), seeded request order, raw records, source/data hashes, and a report generator that independently recomputes scores. Reference labels are AI-assisted and rule-derived, not independently human-annotated.

Run these commands from a repository checkout; the npm package excludes `experiments/`.

```sh
# Inspect the plan without making a model call
npm run experiment -- --provider agy --model gemini-3.8-flash-low --plan --split test --out experiments/results/my-plan
# Use dev to choose settings, then freeze settings before evaluating test
env -u FAST_JEV_EFFORT npm run experiment -- --config examples/config.json --provider agy --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 --split dev --limit 8 --repeats 1 --out experiments/results/my-dev
env -u FAST_JEV_EFFORT npm run experiment -- --config examples/config.json --provider agy --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 --split test --repeats 1 --batch-size 1 --out experiments/results/my-test-single
env -u FAST_JEV_EFFORT npm run experiment -- --config examples/config.json --provider agy --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 --split test --repeats 3 --batch-size 8 --out experiments/results/my-test-batch-8
npm run experiment:report -- experiments/results/my-test-single
npm run experiment:report -- experiments/results/my-test-batch-8
```

**Live AGY results (2026-09-20).** The frozen 64-case test suite has real singleton and batch results:

| Mode | First-repeat correct / attempted | Request success / attempted (all repeats) | Successful-request p50 / p95 |
| --- | ---: | ---: | ---: |
| [Singleton, one repeat](experiments/results/agy-recovered-test-single/report.md) | 62/64 (96.88%) | 62/64 | 11.92 s / 23.73 s |
| [Batch of eight, three repeats](experiments/results/agy-recovered-test-batch-8/report.md) | 64/64 (100%) | 24/24 | 12.82 s / 21.16 s |

Both failed requests were `AGY_TIMEOUT` at the 30 s timeout. All 62 successful predictions were correct; score tasks matched exactly in 16/16 cases (MAE 0). The 96.88% end-to-end rate includes the two failures. Successful-request percentiles exclude them; all-attempt p50/p95 were 11.94 s / 29.59 s.

Batch mode answered all 192 case executions correctly, with exactly consistent predictions for all 64 cases across three repeats. Those repeats are not 192 independent quality samples. Mean batch time divided by eight was **1.69 s per case**, an amortized cost rather than individual response latency; request p50 was still 12.82 s. This small synthetic suite is not a production-quality guarantee.

The raw singleton artifacts incorrectly label the two timeout errors as `authentication` in a secondary category field. Their `AGY_TIMEOUT` codes, failure counts and reported metrics are correct. The [erratum](experiments/ERRATA.md) preserves the original records and documents the error-classification fix applied after both formal runs.

The [formal protocol](experiments/protocols/agy-recovery-20260920.md) was frozen before testing: all 64 test cases, one singleton repeat and three batch-of-eight repeats, a 30 s timeout, and unchanged production code. It contains the exact reproduction commands. Earlier [singleton](experiments/results/agy-recovered-dev-single/report.md) and [batch](experiments/results/agy-recovered-dev-batch-8/report.md) development checks each scored 8/8. A [lean-agent candidate](experiments/results/agy-lean-dev-single/report.md) also scored 8/8 on dev, but did not improve mean or tail latency and was not adopted. The historical `agy-single` and `agy-batch-8` directories remain **unexecuted plans**; actual runs use separate directories.

[Published Jev experiments](experiments/baselines/jev-public.md) are separately sourced historical references. Different datasets, environments, and timing boundaries prevent a direct ranking or a claim that fast-jev beats Jev.

We measured and improved local wrapper overhead by reusing an already validated request. In five alternating AB/BA pairs, each with 1,000 measured samples per batch size, the medians of per-run p50 were:

| Items per call | Before | After | Median paired reduction |
| ---: | ---: | ---: | ---: |
| 1 | 0.0260 ms | 0.0220 ms | 15.60% |
| 8 | 0.0829 ms | 0.0553 ms | 33.96% |
| 32 | 0.2414 ms | 0.1550 ms | 35.73% |

These are **local fixture timings with zero network or model inference**, not AGY response times or a Jev comparison. The saved pre-change implementation and all 30,000 samples are included. [Raw A/B comparison](experiments/results/overhead-ab/comparison.json).

```sh
npm run benchmark:local -- --out experiments/results/my-overhead-ab
```

## Limits

This wrapper validates structure, allowed values, and ranges; it cannot guarantee correct judgments or resist every prompt injection. Keep exact arithmetic in code and evaluate thresholds on your own labeled examples. Inputs are sent to the selected backend; agy reuses its own authentication and service routing. No latency, cost, or calibration claims are made without measurements.

Read the [full Jev research and validation plan](docs/research-jev.md) for the distinction between the original decision model and this no-training wrapper.

Implementation details: [architecture](docs/architecture.md) · [verification record](docs/validation.md).

[Distribution](docs/distribution.md) · [Privacy and package contents](docs/security.md).
