# Operational follow-up: default 60-second deadline

Written after the preserved 30-second run stopped, and before this follow-up's
test calls. This is an explicit protocol revision, not a retry hidden inside the
initial experiment.

The [initial protocol](agy-jev-openrouter-20260920.md) stopped after three
consecutive AGY timeouts. Its immutable result directory is
`agy-jev-openrouter-test-20260920`: 15/64 singleton cases attempted per backend,
AGY 8 correct and 7 timeouts, Jev 15 correct; batch mode was not reached. Remaining
cases are `not_run`. These results must remain linked beside the follow-up.

A separate three-case **development-only** diagnostic used a 60-second limit and
an observer forwarding AGY's unchanged streams. All three calls succeeded in
11.37–14.58 seconds; SUCCESS was followed by process close in about one second.
This does not establish the cause of the earlier timeouts. There is no observed
production-code defect to fix, and the adapter, prompts, labels and score mapping
remain unchanged. The observer is excluded from formal calls.

## Changes fixed before this follow-up

- Set **both** backends' end-to-end timeout to **60,000 ms**, the production CLI
  default. This allows slower successful AGY calls to be distinguished from
  failures while keeping their full latency in the results.
- Run modes in order **8, then 1**, so a repeat of singleton instability does
  not prevent measurement of the independent batching condition.
- Start a new directory and measure both backends afresh. Do not fill holes in
  the stopped run or select the best result for each case from either run.
- Keep all other rules: complete 64-case test set per mode, seed 20260920, one
  repeat, one excluded development warmup per backend/mode, alternating paired
  serial calls, no application retries, three consecutive measured failures
  stop the entire run, all failures/not-run records retained.
- The planned budget remains 144 measured calls plus four warmups.

```sh
node experiments/compare.mjs --timeout 60000 --batch-sizes 8,1 \
  --out experiments/results/agy-jev-openrouter-60s-test-20260920
node experiments/compare-report.mjs \
  experiments/results/agy-jev-openrouter-60s-test-20260920
```

The same frozen implementation commit is
`d09f2408e79b32b4bec99db62af10268911c1195`; source hashes are recorded again in the
new manifest. The revision follows observed infrastructure failures on an already
observed synthetic test set. Report this selection history openly; neither this
follow-up nor the initial attempt is an unseen holdout, and a completed follow-up
does not erase initial failures or guarantee production reliability.
