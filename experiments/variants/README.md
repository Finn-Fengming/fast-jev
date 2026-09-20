# Retained experiment variants

These sources are research artifacts. The production adapter remains `src/agy.mjs`; the lean candidate was not adopted. Do not replace production files in your working checkout to reproduce an experiment.

| File | Purpose |
|---|---|
| `decision-before-validation-reuse.mjs` | Earlier decision pipeline for the existing offline wrapper-overhead A/B |
| `agy-lean-candidate.mjs` | Production AGY adapter plus a private, per-request custom agent and `--agent fast-jev` |
| `agy-lean-audit.mjs` | Same lean candidate with sanitized counters for agent/tool/turn diagnostics |

The lean agent requests `tools: []`, `inheritMcp: false`, `excludeDefaultComponents: true`, command execution off, and empty skills/rules. Installed AGY 1.2.1 release notes document excluding default prompt components and built-in tools while retaining post-invocation hooks. The public [custom-agent documentation](https://antigravity.google/docs/subagents/) specifies workspace discovery and frontmatter; [headless documentation](https://antigravity.google/docs/cli/headless/) specifies cached authentication, agent selection, and stream events. Configuration alone does not prove a tool-free runtime.

Both sources preserve cached-login reuse, plan mode, terminal sandbox, JSON schema, timeout, cancellation, process cleanup, and response validation. The audit source returns an additional `diagnostic` field from `runAgy()`; the regular `decide()` pipeline does not propagate this field. Audit counters do not retain tool arguments, outputs, or arbitrary custom tool names. A tool may emit multiple events, so event counts and unique indexed tool steps are distinct.

## Reproduce the unadopted lean candidate in isolated worktrees

Requirements: Node.js 22+, Git, a working authenticated local `agy`, and a checkout containing these variant files. Run the following from the current repository root in Bash. It pins the production baseline to the republished baseline commit and copies the retained candidate into a separate detached worktree. Temporary paths are unique; no branch is modified.

```bash
variant_repo=$(pwd -P)
variant_root=$(mktemp -d "${TMPDIR:-/tmp}/fast-jev-lean-repro.XXXXXX")
variant_baseline="$variant_root/baseline"
variant_candidate="$variant_root/candidate"

git worktree add --detach "$variant_baseline" 103de936da5072a5681b96a67ef2e42e48316195
git worktree add --detach "$variant_candidate" 103de936da5072a5681b96a67ef2e42e48316195
cp "$variant_repo/experiments/variants/agy-lean-candidate.mjs" "$variant_candidate/src/agy.mjs"

node --check "$variant_candidate/src/agy.mjs"
git -C "$variant_candidate" diff -- src/agy.mjs
```

Run baseline and candidate **sequentially**, on the same eight development cases and unchanged parameters. These commands deliberately do not consume the held-out test split:

```bash
(
  cd "$variant_baseline"
  env -u FAST_JEV_EFFORT node experiments/run.mjs \
    --config examples/config.json --provider agy \
    --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 \
    --split dev --limit 8 --repeats 1 --batch-size 1 --warmup 1 \
    --seed 20260920 --max-errors 3 \
    --out "$variant_root/results/baseline-dev"
  node experiments/report.mjs "$variant_root/results/baseline-dev"
)

(
  cd "$variant_candidate"
  env -u FAST_JEV_EFFORT node experiments/run.mjs \
    --config examples/config.json --provider agy \
    --model gemini-3.8-flash-low --agy-bin agy --timeout 30000 \
    --split dev --limit 8 --repeats 1 --batch-size 1 --warmup 1 \
    --seed 20260920 --max-errors 3 \
    --out "$variant_root/results/candidate-dev"
  node experiments/report.mjs "$variant_root/results/candidate-dev"
)
```

The result directories sit outside both worktrees, and manifests capture the modified candidate source hash even though both Git HEADs identify the baseline commit. Preserve the entire `$variant_root/results` directory and the current variant sources before removing temporary worktrees. Existing output directories cannot be overwritten. A further reproduction must create a fresh temporary root.

See [source provenance](../PROVENANCE.md) for the Git history update. This reproduces the selected eight-case inference protocol, not a guarantee of identical outputs or timings: service state, caches, account settings, AGY version, network, and sequential run order may vary. Keep both variants' wrong answers, failures, and all latency samples. The recovery evaluation protocol records the development evidence and the decision not to adopt the candidate in [agy-recovery-20260920.md](../protocols/agy-recovery-20260920.md).

## Audit copy

For an optional diagnostic call, run the following from the current repository root. It makes **one real AGY call**, using the development request already archived in `agy-lean-dev-audit/report.json`, and prints a fresh observation without overwriting the original evidence. Only `saved.request` enters the prompt; the saved prediction and diagnostic do not.

```bash
env -u FAST_JEV_EFFORT node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { buildDecision, validateOutput } from './src/decision.mjs';
import { runAgy } from './experiments/variants/agy-lean-audit.mjs';

const saved = JSON.parse(await readFile(
  'experiments/results/agy-lean-dev-audit/report.json', 'utf8'));
const started = performance.now();
const built = buildDecision(saved.request);
const output = await runAgy({
  prompt: built.prompt,
  schema: built.schema,
  model: 'gemini-3.8-flash-low',
  agyBin: 'agy',
  timeoutMs: 30000,
});
const results = validateOutput(output.data, built.request);
console.log(JSON.stringify({
  kind: 'exploratory_dev_transport_audit_reproduction',
  created_at: new Date().toISOString(),
  case_id: saved.case_id,
  requested_model: output.model,
  elapsed_ms: performance.now() - started,
  backend_duration_ms: output.backendDurationMs,
  usage: output.usage,
  diagnostic: output.diagnostic,
  results,
}, null, 2));
JS
```

This direct import exposes the adapter's sanitized `diagnostic` field. The normal CLI intentionally discards that extra field. Do not substitute the audit copy into a formal benchmark: its instrumentation is a separate observation.

The observed audit reported agent `fast-jev`, 57 advertised tools, zero tool events and `num_turns: 2`. These values are recorded without inferring their cause. Persistent stdin sessions were not introduced: documented AGY streaming sessions share conversation history and cumulative counters, which changes independent-decision semantics.
