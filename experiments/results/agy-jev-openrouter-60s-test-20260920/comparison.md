# Matched AGY versus native Jev comparison

Status: completed_with_errors. Metrics were recomputed from frozen labels and raw typed answers.

UTC clock warnings: 2; monotonic timing remains authoritative for elapsed time and serial execution checks.

The two pathways use the same cases, question order and batch grouping. Calls are sequential and paired; backend order alternates. Warmups are excluded.

## Quality (first measured repeat)

| Mode | Backend | Correct / attempted | Valid / attempted | Successful-response accuracy | Attempted case coverage | Score MAE | Score exact match |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| b8 | agy | 48/64 (75.00%) | 48/64 (75.00%) | 100.00% | 64/64 | 0.0000 | 100.00% |
| b8 | jev | 63/64 (98.44%) | 64/64 (100.00%) | 98.44% | 64/64 | 0.0569 | 68.75% |
| b1 | agy | 59/64 (92.19%) | 59/64 (92.19%) | 100.00% | 64/64 | 0.0000 | 100.00% |
| b1 | jev | 64/64 (100.00%) | 64/64 (100.00%) | 100.00% | 64/64 | 0.0075 | 56.25% |

Backend failures count as incorrect in end-to-end accuracy. Unrun cases remain visible through coverage and are excluded from attempted denominators. Continuous Jev scores are not rounded; score correctness uses absolute error ≤ 0.5.

## Request latency (milliseconds)

| Mode | Backend | Success / attempted / planned | Success p50 | Success p95 | Success mean | All-attempt p50 | All-attempt p95 | Amortized successful ms/case |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| b8 | agy | 6/8/8 | 12891.56 | 44181.68 | 22589.93 | 13302.55 | 60264.25 | 2823.74 |
| b8 | jev | 8/8/8 | 323.74 | 461.82 | 362.12 | 323.74 | 461.82 | 45.26 |
| b1 | agy | 59/64/64 | 13446.58 | 44664.65 | 17557.36 | 13770.81 | 54155.11 | 17557.36 |
| b1 | jev | 64/64/64 | 317.70 | 457.64 | 339.18 | 317.70 | 457.64 | 339.18 |

A batch request is one latency sample. Amortized time is request time divided by case count, **not individual response latency**. Successful and all-attempt latency use their own sample counts; failed timings are not successful inference latency.

## Same-mode speed ratios

| Mode | AGY/Jev successful p50 | AGY/Jev successful mean | Both-success pairs | Median paired AGY/Jev ratio |
| --- | ---: | ---: | ---: | ---: |
| b8 | 39.82 | 62.38 | 6 | 42.14 |
| b1 | 42.32 | 51.76 | 59 | 42.56 |

A ratio above 1 means AGY took longer than Jev; below 1 means AGY was faster. Ratios compare the same batch mode only, and do not isolate model compute from transport/process overhead.

## Quality breakdowns (first measured repeat)

| Mode | Group | Value | Backend | Correct / attempted | Valid rate | Score MAE | Score exact match |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| b8 | by_category | grounded_boolean | agy | 13/16 (81.25%) | 81.25% | N/A | N/A |
| b8 | by_category | policy_choice | agy | 9/16 (56.25%) | 56.25% | N/A | N/A |
| b8 | by_category | routing_choice | agy | 11/16 (68.75%) | 68.75% | N/A | N/A |
| b8 | by_category | rubric_score | agy | 15/16 (93.75%) | 93.75% | 0.0000 | 100.00% |
| b8 | by_category | grounded_boolean | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | policy_choice | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | routing_choice | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_category | rubric_score | jev | 15/16 (93.75%) | 100.00% | 0.0569 | 68.75% |
| b8 | by_language | en | agy | 23/32 (71.88%) | 71.88% | 0.0000 | 100.00% |
| b8 | by_language | zh | agy | 25/32 (78.13%) | 78.13% | 0.0000 | 100.00% |
| b8 | by_language | en | jev | 32/32 (100.00%) | 100.00% | 0.0113 | 75.00% |
| b8 | by_language | zh | jev | 31/32 (96.88%) | 100.00% | 0.1025 | 62.50% |
| b8 | by_kind | boolean | agy | 13/16 (81.25%) | 81.25% | N/A | N/A |
| b8 | by_kind | choice | agy | 20/32 (62.50%) | 62.50% | N/A | N/A |
| b8 | by_kind | score | agy | 15/16 (93.75%) | 93.75% | 0.0000 | 100.00% |
| b8 | by_kind | boolean | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_kind | choice | jev | 32/32 (100.00%) | 100.00% | N/A | N/A |
| b8 | by_kind | score | jev | 15/16 (93.75%) | 100.00% | 0.0569 | 68.75% |
| b1 | by_category | grounded_boolean | agy | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_category | policy_choice | agy | 14/16 (87.50%) | 87.50% | N/A | N/A |
| b1 | by_category | routing_choice | agy | 14/16 (87.50%) | 87.50% | N/A | N/A |
| b1 | by_category | rubric_score | agy | 15/16 (93.75%) | 93.75% | 0.0000 | 100.00% |
| b1 | by_category | grounded_boolean | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_category | policy_choice | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_category | routing_choice | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_category | rubric_score | jev | 16/16 (100.00%) | 100.00% | 0.0075 | 56.25% |
| b1 | by_language | en | agy | 30/32 (93.75%) | 93.75% | 0.0000 | 100.00% |
| b1 | by_language | zh | agy | 29/32 (90.63%) | 90.63% | 0.0000 | 100.00% |
| b1 | by_language | en | jev | 32/32 (100.00%) | 100.00% | 0.0025 | 75.00% |
| b1 | by_language | zh | jev | 32/32 (100.00%) | 100.00% | 0.0125 | 37.50% |
| b1 | by_kind | boolean | agy | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_kind | choice | agy | 28/32 (87.50%) | 87.50% | N/A | N/A |
| b1 | by_kind | score | agy | 15/16 (93.75%) | 93.75% | 0.0000 | 100.00% |
| b1 | by_kind | boolean | jev | 16/16 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_kind | choice | jev | 32/32 (100.00%) | 100.00% | N/A | N/A |
| b1 | by_kind | score | jev | 16/16 (100.00%) | 100.00% | 0.0075 | 56.25% |

Native Jev probabilities and AGY self-reported confidence are not compared. The fixed synthetic cases have been observed previously; this is not an unseen benchmark or evidence of general production superiority. Repeated/template-related cases are not independent population samples. N/A indicates absent observations.

Artifact checks establish internal consistency, not independent provenance or tamper-proof timestamps. Source and artifact hashes, coverage, failure counts and all computed metrics are available in `comparison.json`.
