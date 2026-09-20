/**
 * Metrics for the local synthetic decision benchmark.
 * Accuracy rates are fractions, not percentages. Confidence values returned by
 * a model are deliberately unused: they are not calibrated probabilities.
 */
export const SCORE_TOLERANCE = 0.5;

export function scoreCase(caseData, results) {
  const questions = caseData?.request?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new TypeError('A benchmark case must contain at least one question.');
  }
  const output = Array.isArray(results) ? results : results?.results;
  const byId = new Map();
  for (const result of Array.isArray(output) ? output : []) {
    if (!result || typeof result !== 'object') continue;
    const matching = byId.get(result.id) ?? [];
    matching.push(result);
    byId.set(result.id, matching);
  }
  const seen = new Set();
  const scored = questions.map((question) => {
    const { id, type } = question;
    if (seen.has(id)) throw new TypeError(`Duplicate benchmark question id: ${id}`);
    seen.add(id);
    if (!Object.hasOwn(caseData.expected ?? {}, id)) {
      throw new TypeError(`Missing expected answer for question: ${id}`);
    }
    const expected = caseData.expected[id];
    const min = question.min ?? 0;
    const max = question.max ?? 1;
    const accepts = (value) => {
      if (type === 'choice') return typeof value === 'string' && question.options?.includes(value) === true;
      if (type === 'boolean') return typeof value === 'boolean';
      if (type === 'score') return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
      throw new TypeError(`Unknown benchmark question type: ${type}`);
    };
    if (type === 'score' && (!Number.isFinite(min) || !Number.isFinite(max) || min > max)) {
      throw new TypeError(`Invalid score range for question: ${id}`);
    }
    if (!accepts(expected)) throw new TypeError(`Invalid expected answer for question: ${id}`);
    const matching = byId.get(id) ?? [];
    const result = matching.length === 1 ? matching[0] : undefined;
    const predicted = result?.value ?? null;
    const valid = Boolean(result && result.type === type
      && (result.status === undefined || result.status === 'ok') && accepts(predicted));
    const score = { id, type, expected, predicted, valid, correct: false };
    if (valid && type === 'score') {
      score.absolute_error = Math.abs(predicted - expected);
      // A zero-width range admits only its exact answer.
      score.normalized_absolute_error = max === min ? 0 : score.absolute_error / (max - min);
      score.correct = score.absolute_error <= SCORE_TOLERANCE;
    } else {
      score.correct = valid && predicted === expected;
    }
    return score;
  });
  return {
    questions: scored,
    correct: scored.every((question) => question.correct),
    valid: scored.every((question) => question.valid),
  };
}

/** Nearest-rank percentile: p in [0, 100], with p=0 returning the minimum. */
export function percentile(values, p) {
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new RangeError('Percentile must be between 0 and 100.');
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('Percentile values must be finite numbers.');
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latency(records) {
  const values = records.map((record) => record.elapsed_ms)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return {
    sample_count: values.length,
    mean: mean(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
  };
}

function wilson95(correct, total) {
  if (total === 0) return null;
  const z = 1.959963984540054;
  const proportion = correct / total;
  const denominator = 1 + z * z / total;
  const center = (proportion + z * z / (2 * total)) / denominator;
  const radius = z * Math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / denominator;
  return {
    method: 'Wilson',
    confidence_level: 0.95,
    unit: 'unique case, first measured repeat',
    sample_size: total,
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
  };
}

function aggregate(records, { includeInterval = false } = {}) {
  const attempted = records.filter((record) => record.status !== 'not_run');
  const successes = records.filter((record) => record.status === 'ok');
  const errors = records.filter((record) => record.status === 'error');
  const valid = successes.filter((record) => record.score?.valid === true);
  const correct = valid.filter((record) => record.score?.correct === true);
  const questions = successes.flatMap((record) => record.score?.questions ?? []);
  const choiceBool = questions.filter((question) => question.type === 'choice' || question.type === 'boolean');
  const scores = questions.filter((question) => question.type === 'score');
  const validScores = scores.filter((question) => question.valid && Number.isFinite(question.absolute_error));
  const errorCounts = new Map();
  for (const error of errors) {
    const code = error.error?.code ?? 'UNKNOWN';
    errorCounts.set(code, (errorCounts.get(code) ?? 0) + 1);
  }
  const result = {
    record_count: records.length,
    unique_case_count: new Set(records.map((record) => record.case_id)).size,
    attempted_count: attempted.length,
    success_count: successes.length,
    error_count: errors.length,
    not_run_count: records.length - attempted.length,
    valid_count: valid.length,
    correct_count: correct.length,
    valid_rate: ratio(valid.length, attempted.length),
    end_to_end_correct_rate: ratio(correct.length, attempted.length),
    observed_success_accuracy: ratio(correct.length, successes.length),
    choice_bool_question_count: choiceBool.length,
    choice_bool_accuracy: ratio(choiceBool.filter((question) => question.valid && question.correct).length, choiceBool.length),
    score_question_count: scores.length,
    score_valid_count: validScores.length,
    score_mae: mean(validScores.map((question) => question.absolute_error)),
    score_normalized_mae: mean(validScores.map((question) => question.normalized_absolute_error)),
    score_exact_match: ratio(scores.filter((question) => question.valid && question.absolute_error === 0).length, scores.length),
    score_within_tolerance: ratio(scores.filter((question) => question.valid && question.correct).length, scores.length),
    latency_ms: latency(attempted),
    successful_latency_ms: latency(successes),
    errors_by_code: Object.fromEntries(errorCounts),
  };
  if (includeInterval) result.accuracy_wilson95 = wilson95(correct.length, attempted.length);
  return result;
}

function groupMetrics(records, key) {
  const groups = new Map();
  for (const record of records) {
    const label = String(record[key] ?? 'unknown');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(record);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([label, rows]) => [label, aggregate(rows)]));
}

function repeatConsistency(records, expectedRepeats) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.case_id)) groups.set(record.case_id, []);
    groups.get(record.case_id).push(record);
  }
  let complete = 0;
  let eligible = 0;
  let consistent = 0;
  if (expectedRepeats >= 2) {
    for (const rows of groups.values()) {
      if (rows.length !== expectedRepeats) continue;
      complete += 1;
      if (!rows.every((row) => row.status === 'ok' && row.score?.valid === true)) continue;
      eligible += 1;
      const predictions = rows.map((row) => JSON.stringify([...row.score.questions]
        .sort((a, b) => a.id.localeCompare(b.id)).map(({ id, type, predicted }) => [id, type, predicted])));
      if (predictions.every((prediction) => prediction === predictions[0])) consistent += 1;
    }
  }
  return {
    expected_repeats: expectedRepeats,
    complete_case_count: complete,
    eligible_case_count: eligible,
    consistent_case_count: consistent,
    consistency_rate: ratio(consistent, eligible),
    definition: 'Exact typed predictions across all planned repeats; only complete cases with all repeats successful and valid. Scores use exact equality, not the accuracy tolerance.',
  };
}

export function summarize(records, { plannedCases, expectedRepeats = 1 } = {}) {
  if (!Array.isArray(records)) throw new TypeError('Records must be an array.');
  if (!Number.isInteger(expectedRepeats) || expectedRepeats < 1) {
    throw new RangeError('expectedRepeats must be a positive integer.');
  }
  const plannedCount = Array.isArray(plannedCases) ? plannedCases.length : plannedCases ?? null;
  if (plannedCount !== null && (!Number.isInteger(plannedCount) || plannedCount < 0)) {
    throw new RangeError('plannedCases must be a nonnegative integer or an array.');
  }
  const measured = records.filter((record) => record.phase === 'measure');
  const seen = new Set();
  for (const record of measured) {
    if (typeof record.case_id !== 'string' || record.case_id.length === 0) throw new TypeError('Each measured record needs a case_id.');
    if (!Number.isInteger(record.repeat) || record.repeat < 0 || record.repeat >= expectedRepeats) {
      throw new RangeError(`Invalid repeat index for case: ${record.case_id}`);
    }
    if (!['ok', 'error', 'not_run'].includes(record.status)) throw new TypeError(`Unknown record status: ${record.status}`);
    const key = JSON.stringify([record.case_id, record.repeat]);
    if (seen.has(key)) throw new TypeError(`Duplicate measured case and repeat: ${key}`);
    seen.add(key);
  }
  const primaryRows = measured.filter((record) => record.repeat === 0);
  const primary = aggregate(primaryRows, { includeInterval: true });
  const repeated = aggregate(measured);
  const attemptedCases = new Set(measured.filter((record) => record.status !== 'not_run').map((record) => record.case_id)).size;
  const successfulCases = new Set(measured.filter((record) => record.status === 'ok').map((record) => record.case_id)).size;
  const expectedRecords = plannedCount === null ? null : plannedCount * expectedRepeats;
  return {
    record_count: repeated.record_count,
    unique_case_count: repeated.unique_case_count,
    attempted_count: repeated.attempted_count,
    success_count: repeated.success_count,
    error_count: repeated.error_count,
    not_run_count: repeated.not_run_count,
    valid_count: repeated.valid_count,
    valid_rate: repeated.valid_rate,
    coverage: {
      planned_case_count: plannedCount,
      recorded_case_count: repeated.unique_case_count,
      attempted_case_count: attemptedCases,
      successful_case_count: successfulCases,
      recorded_case_rate: plannedCount === null ? null : ratio(repeated.unique_case_count, plannedCount),
      attempted_case_rate: plannedCount === null ? null : ratio(attemptedCases, plannedCount),
      expected_record_count: expectedRecords,
      recorded_record_rate: expectedRecords === null ? null : ratio(measured.length, expectedRecords),
    },
    primary,
    repeated,
    repeat_consistency: repeatConsistency(measured, expectedRepeats),
    by_category: groupMetrics(primaryRows, 'category'),
    by_language: groupMetrics(primaryRows, 'language'),
    by_kind: groupMetrics(primaryRows, 'kind'),
    methodology: {
      primary: 'First measured repeat only; warmup excluded. Backend failures count as incorrect in end_to_end_correct_rate. not_run records are excluded from attempted denominators and reported in coverage.',
      score_tolerance: SCORE_TOLERANCE,
      score_tolerance_boundary: 'inclusive: absolute error <= 0.5',
      score_mae: 'Valid numeric score predictions only; invalid, missing and abstained predictions have no numeric error and count as incorrect for score_within_tolerance.',
      question_accuracy: 'choice_bool_accuracy and score_within_tolerance use questions present in scored successful backend responses, including invalid/missing/abstained questions as incorrect. Backend errors are counted by end_to_end_correct_rate.',
      confidence: 'Self-reported model confidence is not used as a probability or a correctness score.',
      latency: 'Milliseconds per recorded case request, including failures; successful_latency_ms excludes backend errors. A batched request duration may be shared by multiple cases, so these are not independent request samples and no throughput is computed here.',
      uncertainty: 'Wilson 95% interval uses only unique cases from repeat 0. A small synthetic benchmark is not a random sample of production tasks; the interval does not justify generalization or a cross-benchmark superiority claim.',
    },
  };
}
