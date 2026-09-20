# Development-only AGY timeout diagnostic

This is not part of the formal AGY/Jev accuracy or speed table. It uses three
seed-selected development cases, a 60-second timeout, no warmup, and one repeat.
The unmodified production adapter calls the saved observer, which forwards
streams unchanged and records only event kinds, success flags and numeric time.
The exact observer source and its sanitized timeline are retained here.

All three calls succeeded (11,371.304 / 14,579.296 / 14,574.964 ms). Observed
SUCCESS events preceded process close by about one second. These observations
do not identify why earlier, different test calls timed out; no production fix
or prompt change was made on this evidence.

On macOS, reproduce from the repository root using a new output directory:

```sh
cp experiments/results/agy-jev-timeout-dev-20260920/observer-source.mjs /private/tmp/fast-jev-agy-event-probe.mjs
chmod 700 /private/tmp/fast-jev-agy-event-probe.mjs
node experiments/run.mjs --config examples/config.json --provider agy \
  --model gemini-3.8-flash-low --agy-bin /private/tmp/fast-jev-agy-event-probe.mjs \
  --timeout 60000 --split dev --limit 3 --repeats 1 --batch-size 1 --warmup 0 \
  --out experiments/results/my-timeout-dev
node experiments/report.mjs experiments/results/my-timeout-dev
```

The observer appends to `/private/tmp/fast-jev-agy-dev-events.jsonl`; use a fresh
local log path for another run. No text content, tool names, session identifiers,
credential values or raw stderr are saved in `events.jsonl`.
