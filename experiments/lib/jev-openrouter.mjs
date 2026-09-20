import { createHash } from 'node:crypto';
import { validateRequest } from '../../src/decision.mjs';
import { FastJevError } from '../../src/errors.mjs';

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const DEFAULT_MODEL = 'typesafe/jev-1.13';
const MODEL_ID = /^typesafe\/jev-\d+(?:\.\d+)*(?:-\d{8})?$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const bounded = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const fail = (code, message, exitCode = 1) => { throw new FastJevError(code, message, exitCode); };
const invalid = () => fail('INVALID_RESPONSE', 'Jev returned an invalid typed decision response.');
const scoreRange = question => question.min === 0 && Number.isInteger(question.max) && question.max <= 9;

function normalizedRequest(request) {
  try { return validateRequest(request); }
  catch { fail('INVALID_REQUEST', 'Jev requires a valid fast-jev decision request.', 2); }
}

/** Translate an already batched request without changing its state or instructions. */
export function buildJevRequest(request, { model = DEFAULT_MODEL, scoreLevels } = {}) {
  if (typeof model !== 'string' || model.length > 100 || !MODEL_ID.test(model)) {
    fail('INVALID_REQUEST', 'Jev requires a pinned typesafe/jev model ID.', 2);
  }
  const normalized = normalizedRequest(request);
  const questions = normalized.questions.map(question => {
    const instructions = question.prompt;
    if (question.type === 'choice') return [question.id, {
      type: 'choice', instructions,
      criteria: Object.fromEntries(question.options.map(option => [option, null])),
    }];
    if (question.type === 'boolean') return [question.id, { type: 'noul', instructions }];
    const levels = scoreLevels instanceof Map ? scoreLevels.get(question.id)
      : record(scoreLevels) && Object.hasOwn(scoreLevels, question.id) ? scoreLevels[question.id] : undefined;
    if (!scoreRange(question)
      || !Array.isArray(levels) || levels.length !== question.max + 1
      || [...levels].some(level => typeof level !== 'string' || !level.trim() || /^\s*\d+(?:\.\d+)?\s*$/.test(level))) {
      fail('INVALID_REQUEST', 'Jev score questions require zero-based integer levels with explicit descriptions (1–10 levels).', 2);
    }
    return [question.id, { type: 'score', instructions, criteria: [...levels] }];
  });
  return { model, state: normalized.state, questions: Object.fromEntries(questions) };
}

function parseAnswers(request, envelope) {
  const normalized = normalizedRequest(request);
  if (normalized.questions.some(question => question.type === 'score' && !scoreRange(question))) {
    fail('INVALID_REQUEST', 'Jev score questions require zero-based integer levels (1–10 levels).', 2);
  }
  if (!record(envelope) || !record(envelope.answers)) invalid();
  const ids = normalized.questions.map(question => question.id);
  if (Object.keys(envelope.answers).length !== ids.length
    || ids.some(id => !Object.hasOwn(envelope.answers, id))) invalid();
  const results = [];
  const native = [];
  for (const question of normalized.questions) {
    const answer = envelope.answers[question.id];
    const type = question.type === 'boolean' ? 'noul' : question.type;
    if (!record(answer) || answer.type !== type) invalid();
    const clean = { type };
    let value;
    if (type === 'choice') {
      if (typeof answer.choice !== 'string' || !question.options.includes(answer.choice)) invalid();
      clean.choice = answer.choice;
      value = answer.choice;
    } else if (type === 'noul') {
      if (!bounded(answer.noul, 0, 1)) invalid();
      clean.noul = answer.noul;
      value = answer.noul >= 0.5;
    } else {
      if (!bounded(answer.score, question.min, question.max)) invalid();
      clean.score = answer.score;
      value = answer.score;
    }
    if (type !== 'noul' && Object.hasOwn(answer, 'confidence')) {
      if (!bounded(answer.confidence, 0, 1)) invalid();
      clean.confidence = answer.confidence;
    }
    if (type !== 'noul' && Object.hasOwn(answer, 'probabilities')) {
      const keys = type === 'choice' ? question.options
        : Array.from({ length: question.max + 1 }, (_, index) => String(index));
      if (!record(answer.probabilities) || Object.keys(answer.probabilities).length !== keys.length
        || keys.some(key => !Object.hasOwn(answer.probabilities, key) || !bounded(answer.probabilities[key], 0, 1))) invalid();
      // Keep the provider's numeric values as received, including any rounding.
      clean.probabilities = Object.fromEntries(keys.map(key => [key, answer.probabilities[key]]));
    }
    results.push({ id: question.id, type: question.type, value,
      ...(Object.hasOwn(clean, 'confidence') ? { confidence: clean.confidence } : {}), status: 'ok' });
    // Legends and unknown fields are intentionally omitted: they can contain arbitrary text.
    native.push([question.id, clean]);
  }
  return { results, answers: Object.fromEntries(native) };
}

export function normalizeJevAnswers(request, envelope) {
  return parseAnswers(request, envelope).results;
}

function publicUsage(usage) {
  if (!record(usage)) return null;
  const result = {};
  for (const key of ['input_tokens', 'output_tokens', 'cost']) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0
      && (key === 'cost' || Number.isInteger(value))) result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

async function readBody(response) {
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail('OUTPUT_TOO_LARGE', 'Jev response exceeded 2 MiB.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { invalid(); }
}

/** Experiment-only native endpoint; intentionally has no retry or fallback. */
export async function callJev(request, {
  apiKey, model = DEFAULT_MODEL, timeoutMs = 30000, signal, scoreLevels, fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) {
    fail('INVALID_REQUEST', 'Jev requires a configured OpenRouter API key.', 2);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000 || typeof fetchImpl !== 'function'
    || (signal !== undefined && !(signal instanceof AbortSignal))) {
    fail('INVALID_REQUEST', 'Jev requires a valid request timeout and fetch implementation.', 2);
  }
  const built = buildJevRequest(request, { model, scoreLevels });
  const body = JSON.stringify(built);
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    combined.throwIfAborted();
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: combined,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body,
    });
    if (!response.ok) {
      await response.body?.cancel();
      fail('PROVIDER_HTTP_ERROR', `Jev endpoint returned HTTP ${response.status}.`);
    }
    const envelope = await readBody(response);
    combined.throwIfAborted();
    const parsed = parseAnswers(request, envelope);
    if (typeof envelope.model !== 'string' || !MODEL_ID.test(envelope.model)
      || !(envelope.model === model || new RegExp(`^${model.replaceAll('.', '\\.')}-\\d{8}$`).test(envelope.model))) invalid();
    return {
      results: parsed.results,
      meta: { provider: 'jev-openrouter', model: envelope.model, usage: publicUsage(envelope.usage) },
      native: { answers: parsed.answers, wire_request_sha256: createHash('sha256').update(body).digest('hex') },
    };
  } catch (error) {
    if (signal?.aborted) fail('ABORTED', 'Jev request canceled.', 130);
    if (deadline.aborted) fail('TIMEOUT', 'Jev request exceeded the configured timeout.', 124);
    if (error instanceof FastJevError) throw error;
    fail('PROVIDER_UNAVAILABLE', 'Could not complete the Jev endpoint request.');
  }
}
