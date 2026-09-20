# Matched AGY versus native Jev comparison

Status: partial. Metrics were recomputed from frozen labels and raw typed answers.

UTC clock warnings: 0; monotonic timing remains authoritative for elapsed time and serial execution checks.

The two pathways use the same cases, question order and batch grouping. Calls are sequential and paired; backend order alternates. Warmups are excluded.

## Quality (first measured repeat)

| Mode | Backend | Correct / attempted | Valid / attempted | Successful-response accuracy | Attempted case coverage | Score MAE | Score exact match |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| b1 | agy | 8/15 (53.33%) | 8/15 (53.33%) | 100.00% | 15/64 | 0.0000 | 100.00% |
| b1 | jev | 15/15 (100.00%) | 15/15 (100.00%) | 100.00% | 15/64 | 0.0033 | 66.67% |
| b8 | agy | 0/0 (N/A) | 0/0 (N/A) | N/A | 0/64 | N/A | N/A |
| b8 | jev | 0/0 (N/A) | 0/0 (N/A) | N/A | 0/64 | N/A | N/A |

Backend failures count as incorrect in end-to-end accuracy. Unrun cases remain visible through coverage and are excluded from attempted denominators. Continuous Jev scores are not rounded; score correctness uses absolute error ≤ 0.5.

## Request latency (milliseconds)

| Mode | Backend | Success / attempted / planned | Success p50 | Success p95 | Success mean | All-attempt p50 | All-attempt p95 | Amortized successful ms/case |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| b1 | agy | 8/15/64 | 12248.90 | 16194.85 | 12349.10 | 16194.85 | 30269.48 | 12349.10 |
| b1 | jev | 15/15/64 | 305.02 | 381.97 | 306.02 | 305.02 | 381.97 | 306.02 |
| b8 | agy | 0/0/8 | N/A | N/A | N/A | N/A | N/A | N/A |
| b8 | jev | 0/0/8 | N/A | N/A | N/A | N/A | N/A | N/A |

A batch request is one latency sample. Amortized time is request time divided by case count, **not individual response latency**. Successful and all-attempt latency use their own sample counts; failed timings are not successful inference latency.

## Same-mode speed ratios

| Mode | AGY/Jev successful p50 | AGY/Jev successful mean | Both-success pairs | Median paired AGY/Jev ratio |
| --- | ---: | ---: | ---: | ---: |
| b1 | 40.16 | 40.35 | 8 | 45.57 |
| b8 | N/A | N/A | 0 | N/A |

A ratio above 1 means AGY took longer than Jev; below 1 means AGY was faster. Ratios compare the same batch mode only, and do not isolate model compute from transport/process overhead.

## Quality breakdowns (first measured repeat)

| Mode | Group | Value | Backend | Correct / attempted | Valid rate | Score MAE | Score exact match |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| b1 | by_category | grounded_boolean | agy | 1/5 (20.00%) | 20.00% | N/A | N/A |
| b1 | by_category | policy_choice | agy | 3/4 (75.00%) | 75.00% | N/A | N/A |
| b1 | by_category | routing_choice | agy | 2/3 (66.67%) | 66.67% | N/A | N/A |
| b1 | by_category | rubric_score | agy | 2/3 (66.67%) | 66.67% | 0.0000 | 100.00% |
| b1 | by_category | grounded_boolean | jev | 5/5 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_category | policy_choice | jev | 4/4 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_category | routing_choice | jev | 3/3 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_category | rubric_score | jev | 3/3 (100.00%) | 100.00% | 0.0033 | 66.67% |
| b1 | by_language | en | agy | 3/7 (42.86%) | 42.86% | 0.0000 | 100.00% |
| b1 | by_language | zh | agy | 5/8 (62.50%) | 62.50% | 0.0000 | 100.00% |
| b1 | by_language | en | jev | 7/7 (100.00%) | 100.00% | 0.0000 | 100.00% |
| b1 | by_language | zh | jev | 8/8 (100.00%) | 100.00% | 0.0100 | 0.00% |
| b1 | by_kind | boolean | agy | 1/5 (20.00%) | 20.00% | N/A | N/A |
| b1 | by_kind | choice | agy | 5/7 (71.43%) | 71.43% | N/A | N/A |
| b1 | by_kind | score | agy | 2/3 (66.67%) | 66.67% | 0.0000 | 100.00% |
| b1 | by_kind | boolean | jev | 5/5 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_kind | choice | jev | 7/7 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_kind | score | jev | 3/3 (100.00%) | 100.00% | 0.0033 | 66.67% |
| b8 | by_category | grounded_boolean | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_category | policy_choice | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_category | routing_choice | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_category | rubric_score | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_category | grounded_boolean | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_category | policy_choice | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_category | routing_choice | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_category | rubric_score | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_language | en | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_language | zh | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_language | en | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_language | zh | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_kind | boolean | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_kind | choice | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_kind | score | agy | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_kind | boolean | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_kind | choice | jev | 0/0 (N/A) | N/A | N/A | N/A |
| b8 | by_kind | score | jev | 0/0 (N/A) | N/A | N/A | N/A |

Native Jev probabilities and AGY self-reported confidence are not compared. The fixed synthetic cases have been observed previously; this is not an unseen benchmark or evidence of general production superiority. Repeated/template-related cases are not independent population samples. N/A indicates absent observations.

Artifact checks establish internal consistency, not independent provenance or tamper-proof timestamps. Source and artifact hashes, coverage, failure counts and all computed metrics are available in `comparison.json`.
