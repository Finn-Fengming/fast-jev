import { FastJevError, inputError } from './errors.mjs';
import { safeUsage } from './privacy.mjs';

export const DEFAULT_AGY_MODEL = 'gemini-3.8-flash-low';
export const DEFAULT_TIMEOUT = 60_000;

export function completionUrl(baseUrl = 'https://api.openai.com/v1') {
  let url;
  try { url = new URL(baseUrl); } catch { throw inputError('baseUrl must be an absolute http(s) URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw inputError('baseUrl must use http(s), without credentials, query parameters or fragments.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}

export function validateProviderOptions(options = {}) {
  const provider = options.provider ?? 'agy';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  if (!['agy', 'openai'].includes(provider)) throw inputError('provider must be agy or openai.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw inputError('timeoutMs must be an integer between 1 and 3600000.');
  const model = options.model ?? (provider === 'agy' ? DEFAULT_AGY_MODEL : undefined);
  if (typeof model !== 'string' || !model.trim()) throw inputError('An explicit model is required for the openai provider (--model or FAST_JEV_MODEL).');
  if (options.effort !== undefined && !['low', 'medium', 'high'].includes(options.effort)) throw inputError('effort must be low, medium or high.');
  const result = { ...options, provider, timeoutMs, model };
  if (provider === 'agy') {
    result.agyBin = options.agyBin ?? 'agy';
    if (typeof result.agyBin !== 'string' || !result.agyBin.trim() || result.agyBin.includes('\0')) throw inputError('agyBin must be a command name or executable path.');
  }
  if (provider === 'openai') {
    result.url = completionUrl(options.baseUrl);
    result.responseFormat = options.responseFormat ?? 'json_schema';
    if (!['json_schema', 'json_object', 'text'].includes(result.responseFormat)) throw inputError('responseFormat must be json_schema, json_object or text.');
    if (options.maxTokens !== undefined && (!Number.isInteger(options.maxTokens) || options.maxTokens < 1)) throw inputError('maxTokens must be a positive integer.');
    if (options.apiKey !== undefined && typeof options.apiKey !== 'string') throw inputError('apiKey must be a string.');
    if (options.apiKey && /[\r\n]/.test(options.apiKey)) throw inputError('apiKey must not contain newlines.');
  }
  return result;
}

async function readLimited(response, maxBytes = 2 * 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FastJevError('OUTPUT_TOO_LARGE', 'Provider response exceeded 2 MiB.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runOpenAI(rawOptions) {
  const options = validateProviderOptions({ ...rawOptions, provider: 'openai' });
  const { prompt, schema, model, timeoutMs, signal } = options;
  const started = performance.now();
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };
  if (options.responseFormat === 'json_schema') {
    body.response_format = { type: 'json_schema', json_schema: { name: 'fast_jev_decisions', strict: true, schema } };
  } else if (options.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }
  if (options.responseFormat !== 'json_schema') body.messages[0].content += `\nReturn JSON matching this schema:\n${JSON.stringify(schema)}`;
  if (options.effort) body.reasoning_effort = options.effort;
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  const headers = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  try {
    const response = await fetch(options.url, { method: 'POST', headers, body: JSON.stringify(body), signal: combined, redirect: 'error' });
    // Never echo remote error bodies: some gateways include credentials or request data.
    if (!response.ok) {
      await response.body?.cancel();
      const advice = response.status === 401 || response.status === 403
        ? 'Check the configured API key and endpoint permissions.'
        : response.status === 429 ? 'Provider rate limit reached; retry later.'
          : response.status === 400 ? 'Check the model and output mode; try --response-format json_object or text if schema mode is unsupported.'
            : 'Check endpoint availability and provider logs.';
      throw new FastJevError('PROVIDER_HTTP_ERROR', `OpenAI-compatible endpoint returned HTTP ${response.status}. ${advice}`);
    }
    let envelope;
    try { envelope = JSON.parse(await readLimited(response)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new FastJevError('INVALID_RESPONSE', 'Provider returned invalid JSON.');
      throw error;
    }
    const choice = envelope?.choices?.[0];
    if (choice?.message?.refusal) throw new FastJevError('MODEL_REFUSAL', 'The model refused this request.');
    if (choice?.finish_reason !== 'stop') {
      const reason = ['length', 'tool_calls', 'function_call', 'content_filter'].includes(choice?.finish_reason) ? choice.finish_reason : 'missing or unrecognized';
      throw new FastJevError('INCOMPLETE_RESPONSE', `Expected a completed answer (finish_reason=stop); received ${reason}.`);
    }
    if (choice.message?.tool_calls?.length || choice.message?.function_call) throw new FastJevError('UNEXPECTED_TOOL_CALL', 'The provider returned a tool call instead of a decision.');
    if (typeof choice.message?.content !== 'string') throw new FastJevError('INVALID_RESPONSE', 'Provider response is missing message.content.');
    let data;
    try { data = JSON.parse(choice.message.content); }
    catch { throw new FastJevError('INVALID_RESPONSE', 'The model did not return a single JSON object; use a model with structured output support.'); }
    return { data, usage: safeUsage(envelope.usage), model, provider: 'openai', backendDurationMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (signal?.aborted) throw new FastJevError('ABORTED', 'Request canceled.', 130);
    if (deadline.aborted) throw new FastJevError('TIMEOUT', `Provider exceeded ${timeoutMs} ms.`, 124);
    if (error instanceof FastJevError) throw error;
    throw new FastJevError('PROVIDER_UNAVAILABLE', 'Could not reach the OpenAI-compatible endpoint. Check base URL, network and TLS configuration.');
  }
}

export async function runModel(rawOptions) {
  const options = validateProviderOptions(rawOptions);
  if (options.provider === 'openai') return runOpenAI(options);
  const { runAgy } = await import('./agy.mjs');
  return { ...await runAgy(options), provider: 'agy' };
}
