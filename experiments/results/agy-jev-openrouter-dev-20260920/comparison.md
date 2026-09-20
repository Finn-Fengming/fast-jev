# Matched AGY versus native Jev comparison

Status: completed. Metrics were recomputed from frozen labels and raw typed answers.

The two pathways use the same cases, question order and batch grouping. Calls are sequential and paired; backend order alternates. Warmups are excluded.

## Quality (first measured repeat)

| Mode | Backend | Correct / attempted | Valid / attempted | Successful-response accuracy | Attempted case coverage | Score MAE | Score exact match |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| b8 | agy | 8/8 (100.00%) | 8/8 (100.00%) | 100.00% | 8/8 | 0.0000 | 100.00% |
| b8 | jev | 8/8 (100.00%) | 8/8 (100.00%) | 100.00% | 8/8 | 0.0033 | 66.67% |

Backend failures count as incorrect in end-to-end accuracy. Unrun cases remain visible through coverage and are excluded from attempted denominators. Continuous Jev scores are not rounded; score correctness uses absolute error ≤ 0.5.

## Request latency (milliseconds)

| Mode | Backend | Success / attempted / planned | Success p50 | Success p95 | Success mean | All-attempt p50 | All-attempt p95 | Amortized successful ms/case |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| b8 | agy | 1/1/1 | 10793.14 | 10793.14 | 10793.14 | 10793.14 | 10793.14 | 1349.14 |
| b8 | jev | 1/1/1 | 307.72 | 307.72 | 307.72 | 307.72 | 307.72 | 38.47 |

A batch request is one latency sample. Amortized time is request time divided by case count, **not individual response latency**. Successful and all-attempt latency use their own sample counts; failed timings are not successful inference latency.

## Same-mode speed ratios

| Mode | AGY/Jev successful p50 | AGY/Jev successful mean | Both-success pairs | Median paired AGY/Jev ratio |
| --- | ---: | ---: | ---: | ---: |
| b8 | 35.07 | 35.07 | 1 | 35.07 |

A ratio above 1 means AGY took longer than Jev; below 1 means AGY was faster. Ratios compare the same batch mode only, and do not isolate model compute from transport/process overhead.

## Quality breakdowns (first measured repeat)

| Mode | Group | Value | Backend | Correct / attempted | Valid rate | Score MAE | Score exact match |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| b8 | by_category | grounded_boolean | agy | 2/2 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | policy_choice | agy | 1/1 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | routing_choice | agy | 2/2 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | rubric_score | agy | 3/3 (100.00%) | 100.00% | 0.0000 | 100.00% |
| b8 | by_category | grounded_boolean | jev | 2/2 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | policy_choice | jev | 1/1 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | routing_choice | jev | 2/2 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | rubric_score | jev | 3/3 (100.00%) | 100.00% | 0.0033 | 66.67% |
| b8 | by_language | en | agy | 3/3 (100.00%) | 100.00% | 0.0000 | 100.00% |
| b8 | by_language | zh | agy | 5/5 (100.00%) | 100.00% | 0.0000 | 100.00% |
| b8 | by_language | en | jev | 3/3 (100.00%) | 100.00% | 0.0050 | 50.00% |
| b8 | by_language | zh | jev | 5/5 (100.00%) | 100.00% | 0.0000 | 100.00% |
| b8 | by_kind | boolean | agy | 2/2 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_kind | choice | agy | 3/3 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_kind | score | agy | 3/3 (100.00%) | 100.00% | 0.0000 | 100.00% |
| b8 | by_kind | boolean | jev | 2/2 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_kind | choice | jev | 3/3 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_kind | score | jev | 3/3 (100.00%) | 100.00% | 0.0033 | 66.67% |

Native Jev probabilities and AGY self-reported confidence are not compared. The fixed synthetic cases have been observed previously; this is not an unseen benchmark or evidence of general production superiority. Repeated/template-related cases are not independent population samples. N/A indicates absent observations.

Artifact checks establish internal consistency, not independent provenance or tamper-proof timestamps. Source and artifact hashes, coverage, failure counts and all computed metrics are available in `comparison.json`.
