# Recomputed experiment report

- Status: completed
- Provider: agy; requested model: gemini-3.8-flash-low
- Dataset snapshot SHA-256: `ea7e09f7a30e21bd448994513597018591eb7cc68724ecb2616150bdbb50d348`
- Source SHA-256 recorded at run time: `39c400b34c827b88fb243e65d698249eb0c8808392b4071a932c5eefa3e88230`
- Built-in dataset cross-check: matched; selected cases and labels verified
- Planned cases: 8; repeats: 1; batch size: 1

| Quality (first measured repeat) | Result |
| --- | ---: |
| Attempted cases | 8 |
| Successful backend responses | 8 |
| Valid result rate, including backend errors in denominator | 100.00% |
| End-to-end correct rate, including backend errors | 100.00% |
| Accuracy among successful backend responses | 100.00% |
| Choice/boolean accuracy among scored responses | 100.00% |
| Score MAE, valid numeric outputs only | 0.0000 |
| Score normalized MAE, valid numeric outputs only | 0.0000 |
| Score exact match among scored responses | 100.00% |
| Score within absolute error ≤ 0.5 (inclusive) | 100.00% |
| Wilson 95% interval, first-repeat end-to-end rate | 67.56% – 100.00% |
| Attempted unique-case coverage across repeats | 100.00% |
| Exact consistency across complete valid repeats | N/A |

| Request-level performance (all measured repeats, warmup excluded) | Result |
| --- | ---: |
| Planned / attempted / successful / failed / not run | 8 / 8 / 8 / 0 / 0 |
| Successful request latency p50 (ms) | 12570.03 |
| Successful request latency p95 (ms) | 20561.11 |
| Successful request latency mean (ms) | 13069.34 |
| Successful amortized milliseconds per case | 13069.34 |
| Successful cases / second of measured request time, including failed request time | 0.08 |

Every request is counted once. A batch's duration divided by its case count is amortized cost, **not individual response latency**. Failed request timings are not successful inference timings. Throughput excludes warmup, probing, artifact I/O and other between-request overhead, so it is not whole-run wall-clock throughput.

Scores were recomputed from the frozen case labels and raw result values; stored `record.score` fields were ignored. Missing, abstained and invalid predictions count as incorrect. Unrun cases are excluded from accuracy denominators and exposed by coverage. N/A means the relevant observations are absent, not 0% accuracy.

The first-repeat Wilson interval does not make a small synthetic suite representative of production work. Repeated runs are dependent observations. Published Jev results use different tasks and environments; this report does not establish superiority over Jev.

Integrity checks detect inconsistent or accidentally modified artifacts; hashes stored alongside editable files are not a cryptographic proof of provenance. See `report.json` for all metrics, breakdowns, recorded metadata, and reporting-code hashes. The original `summary.json` is unchanged.
