# Recomputed experiment report

- Status: completed_with_errors
- Provider: agy; requested model: gemini-3.8-flash-low
- Dataset snapshot SHA-256: `084dfcd0772d93850d6e80532c8fac289bf13e3773b9e09c4e633e27567f949a`
- Source SHA-256 recorded at run time: `9f6c59b2ece1d41e07859d9b8973c02ace983af790cbd5bff00d8d49bab82b75`
- Built-in dataset cross-check: matched; selected cases and labels verified
- Planned cases: 64; repeats: 1; batch size: 1

| Quality (first measured repeat) | Result |
| --- | ---: |
| Attempted cases | 64 |
| Successful backend responses | 59 |
| Valid result rate, including backend errors in denominator | 92.19% |
| End-to-end correct rate, including backend errors | 92.19% |
| Accuracy among successful backend responses | 100.00% |
| Choice/boolean accuracy among scored responses | 100.00% |
| Score MAE, valid numeric outputs only | 0.0000 |
| Score normalized MAE, valid numeric outputs only | 0.0000 |
| Score exact match among scored responses | 100.00% |
| Score within absolute error ≤ 0.5 (inclusive) | 100.00% |
| Wilson 95% interval, first-repeat end-to-end rate | 82.98% – 96.62% |
| Attempted unique-case coverage across repeats | 100.00% |
| Exact consistency across complete valid repeats | N/A |

| Request-level performance (all measured repeats, warmup excluded) | Result |
| --- | ---: |
| Planned / attempted / successful / failed / not run | 64 / 64 / 59 / 5 / 0 |
| Successful request latency p50 (ms) | 13446.58 |
| Successful request latency p95 (ms) | 44664.65 |
| Successful request latency mean (ms) | 17557.36 |
| Successful amortized milliseconds per case | 17557.36 |
| Successful cases / second of measured request time, including failed request time | 0.05 |

Every request is counted once. A batch's duration divided by its case count is amortized cost, **not individual response latency**. Failed request timings are not successful inference timings. Throughput excludes warmup, probing, artifact I/O and other between-request overhead, so it is not whole-run wall-clock throughput.

Scores were recomputed from the frozen case labels and raw result values; stored `record.score` fields were ignored. Missing, abstained and invalid predictions count as incorrect. Unrun cases are excluded from accuracy denominators and exposed by coverage. N/A means the relevant observations are absent, not 0% accuracy.

The first-repeat Wilson interval does not make a small synthetic suite representative of production work. Repeated runs are dependent observations. Published Jev results use different tasks and environments; this report does not establish superiority over Jev.

Integrity checks detect inconsistent or accidentally modified artifacts; hashes stored alongside editable files are not a cryptographic proof of provenance. See `report.json` for all metrics, breakdowns, recorded metadata, and reporting-code hashes. The original `summary.json` is unchanged.
