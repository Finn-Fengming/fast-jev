import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { resolveConfig } from './config.mjs';
import { inputError } from './errors.mjs';
import { buildDecision, decide } from './decision.mjs';

const MAX_INPUT = 256 * 1024;
const HELP = `fast-jev — typed decisions via agy or OpenAI-compatible models

Usage: fast-jev <command> [question] [options]        Alias: fjev

Commands:
  choose / classify   Pick one of --option A --option B or --options '["A","B"]'
  check               Return a boolean judgment
  score               Return a score (--min 0 --max 1 by default)
  rank                Score JSON items, sort descending (--input items.json)
  filter              Keep matching JSON items (--input items.json)
  decide / batch      Run typed questions in one call (--input decisions.json)
  doctor              Check backend setup; add --live to make one test decision
  config              Show resolved configuration, excluding API keys

Input:   --context TEXT | --file PATH | piped stdin
         --input PATH (JSON for rank/filter/decide; '-' reads stdin)
Output:  JSON by default; --pretty to indent, --text for the bare value
         --explain for a short reason; --min-confidence 0.8 to abstain below 0.8
Backend: --provider agy|openai --model ID --timeout MS (default: 60000)
         --agy-bin PATH --effort low|medium|high
         --base-url URL --response-format json_schema|json_object|text
         --max-tokens N (OpenAI-compatible max_tokens; optional)
Other:   --top N (rank) --config PATH --dry-run --help --version

Examples:
  fjev choose "Best next step?" --option ship --option investigate --context "Tests failed"
  echo "I was charged twice" | fjev classify "Support queue?" --options '["billing","bug"]'
  fjev decide --input examples/decisions.json
  fjev check "Is the service healthy?" --context "All probes pass" --provider openai --model MODEL

agy is the default; it reuses local login. OpenAI-compatible auth uses OPENAI_API_KEY.
Confidence is model-reported and uncalibrated. No training or automatic retries.
Exit codes: 0 success (including false), 1 backend/output error, 2 invalid input,
            4 abstention, 124 timeout, 130 canceled.
`;

const flagOptions = Object.fromEntries([
  'provider', 'model', 'timeout', 'agy-bin', 'effort', 'base-url', 'response-format',
  'max-tokens', 'config', 'context', 'file', 'input', 'options', 'min', 'max', 'top', 'min-confidence',
].map(key => [key, { type: 'string' }]));
flagOptions.option = { type: 'string', multiple: true };
for (const key of ['help', 'version', 'pretty', 'text', 'explain', 'dry-run', 'live']) flagOptions[key] = { type: 'boolean' };
const COMMON = ['help', 'version', 'provider', 'model', 'timeout', 'agy-bin', 'effort', 'base-url', 'response-format', 'max-tokens', 'config', 'pretty'];

function parse(argv) {
  let parsed;
  try { parsed = parseArgs({ args: argv, options: flagOptions, allowPositionals: true, strict: true, tokens: true }); }
  catch (error) { throw inputError(error.message); }
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option' || token.name === 'option') continue;
    if (seen.has(token.name)) throw inputError(`Duplicate --${token.name}.`);
    seen.add(token.name);
  }
  return parsed;
}

async function readStdin(stream, signal) {
  signal?.throwIfAborted();
  let size = 0;
  const chunks = [];
  const cancel = () => stream.destroy(Object.assign(new Error('Request canceled.'), { code: 'ABORTED', exitCode: 130 }));
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_INPUT) throw inputError('Input exceeds 256 KiB.');
      chunks.push(bytes);
    }
  } finally { signal?.removeEventListener('abort', cancel); }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBounded(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_INPUT) throw inputError('Input must be a regular file of at most 256 KiB.');
    const text = await readFile(path, 'utf8');
    if (Buffer.byteLength(text) > MAX_INPUT) throw inputError('Input exceeds 256 KiB.');
    return text;
  } catch (error) {
    if (error.exitCode) throw error;
    throw inputError(`Cannot read input file: ${error.code ?? 'read failed'}.`);
  }
}

function json(text, label) {
  try { return JSON.parse(text); } catch { throw inputError(`${label} must contain valid JSON.`); }
}

function number(value, fallback, label, min = -Infinity, max = Infinity) {
  if (value === undefined) return fallback;
  if (!String(value).trim()) throw inputError(`${label} must be a number.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw inputError(`${label} must be between ${min} and ${max}.`);
  return result;
}

export async function main(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, signal, env = process.env } = {}) {
  let exitCode = 0;
  try {
    const { values: flags, positionals } = parse(argv);
    if (flags.version) { stdout.write('0.1.0\n'); return 0; }
    if (flags.help || !positionals.length) { stdout.write(HELP); return 0; }
    const aliases = { classify: 'choose', batch: 'decide' };
    const command = Object.hasOwn(aliases, positionals[0]) ? aliases[positionals[0]] : positionals[0];
    const allowed = {
      choose: ['option', 'options'], check: [], score: ['min', 'max'],
      rank: ['input', 'top'], filter: ['input'], decide: ['input'], doctor: ['live'], config: [],
    };
    if (!Object.hasOwn(allowed, command)) throw inputError(`Unknown command: ${command}. Use --help.`);
    const decisionCommand = !['doctor', 'config'].includes(command);
    const inputFlags = decisionCommand ? ['explain', 'min-confidence', 'text', 'dry-run', ...(command === 'decide' ? [] : ['context', 'file'])] : [];
    const accepted = new Set([...COMMON, ...allowed[command], ...inputFlags]);
    for (const key of Object.keys(flags)) if (!accepted.has(key)) throw inputError(`--${key} does not apply to ${command}.`);
    if (flags.pretty && flags.text) throw inputError('Choose either --pretty or --text.');
    if (positionals.length !== (['doctor', 'config', 'decide'].includes(command) ? 1 : 2)) throw inputError(`${command} ${decisionCommand && command !== 'decide' ? 'requires one quoted question' : 'does not accept positional arguments'}.`);
    const options = await resolveConfig(flags, env);
    options.signal = signal;
    const print = value => stdout.write(`${JSON.stringify(value, null, flags.pretty ? 2 : undefined)}\n`);
    if (command === 'config') {
      const { apiKey, signal: ignored, ...safe } = options;
      print({ ...safe, ...(options.provider === 'openai' ? { apiKeyConfigured: Boolean(apiKey) } : {}) });
      return 0;
    }
    if (command === 'doctor') {
      const report = { provider: options.provider, model: options.model, live: Boolean(flags.live) };
      if (options.provider === 'agy') {
        const { probeAgy } = await import('./agy.mjs');
        report.agy = await probeAgy(options);
        const required = ['--input-format', '--output-format', '--json-schema', '--mode', '--sandbox', '--disable-slash-commands'];
        const missing = required.filter(flag => !report.agy.capabilities.includes(flag));
        if (missing.length) throw inputError(`Update agy; required flags missing: ${missing.join(', ')}.`);
        if (!report.agy.models.includes(options.model)) throw inputError(`Model ${options.model} was not listed by agy models. Select an installed model with --model.`);
      } else report.apiKeyConfigured = Boolean(options.apiKey);
      if (flags.live) {
        const sample = await decide({ state: 'The service health check returned HTTP 200 OK.', questions: [{ id: 'healthy', type: 'boolean', prompt: 'Did the service health check succeed?' }] }, options);
        if (sample.results[0].value !== true) throw new Error('Live provider returned an incorrect health-check decision.');
        report.meta = sample.meta;
      }
      report.status = flags.live ? 'ready' : 'configuration_checked';
      print(report);
      return 0;
    }
    const minConfidence = number(flags['min-confidence'], 0, '--min-confidence', 0, 1);
    const explain = flags.explain ?? false;
    let stdinValue;
    const piped = async () => stdinValue ??= await readStdin(stdin, signal);
    const readJsonInput = async () => {
      if (flags.input && flags.input !== '-') return json(await readBounded(flags.input), '--input');
      if (stdin.isTTY) throw inputError('Pass --input FILE or pipe JSON into stdin.');
      return json(await piped(), 'stdin');
    };
    const context = async (allowPipe) => {
      const parts = [];
      if (flags.context !== undefined) parts.push(flags.context);
      if (flags.file) parts.push(await readBounded(flags.file));
      if (allowPipe && !stdin.isTTY && !parts.length) parts.push(await piped());
      return parts.join('\n\n');
    };
    let request, items;
    let top;
    if (command === 'decide') request = await readJsonInput();
    else if (command === 'rank' || command === 'filter') {
      items = await readJsonInput();
      if (!Array.isArray(items) || !items.length || items.length > 100) throw inputError('Items must be a JSON array with 1–100 entries.');
      if (command === 'rank') {
        top = number(flags.top, items.length, '--top', 1, items.length);
        if (!Number.isInteger(top)) throw inputError('--top must be an integer.');
      }
      request = {
        state: { context: await context(false), items },
        questions: items.map((_, index) => ({ id: String(index), type: command === 'rank' ? 'score' : 'boolean', prompt: `Evaluate ONLY items[${index}]. ${positionals[1]}${command === 'rank' ? ' Higher scores mean a better match.' : ''}` })),
      };
    } else {
      const question = { id: 'decision', type: command === 'choose' ? 'choice' : command === 'check' ? 'boolean' : 'score', prompt: positionals[1] };
      if (command === 'choose') {
        if (flags.option && flags.options !== undefined) throw inputError('Use repeated --option or --options JSON, not both.');
        question.options = flags.option ?? (flags.options === undefined ? undefined : json(flags.options, '--options'));
      }
      if (command === 'score') {
        question.min = number(flags.min, 0, '--min');
        question.max = number(flags.max, 1, '--max');
      }
      request = { state: await context(true), questions: [question] };
    }
    const plan = buildDecision(request, { explain });
    if (flags['dry-run']) {
      print({ provider: options.provider, model: options.model, request: plan.request, prompt: plan.prompt, schema: plan.schema });
      return 0;
    }
    const output = await decide(plan.request, { ...options, explain, minConfidence });
    const abstained = output.results.some(result => result.status === 'abstained');
    let result;
    if (items) {
      const evaluated = output.results.map((entry, index) => ({ index, item: items[index], ...entry }));
      result = command === 'rank'
        ? evaluated.filter(entry => entry.status === 'ok').sort((a, b) => b.value - a.value || a.index - b.index).slice(0, top)
        : evaluated.filter(entry => entry.status === 'ok' && entry.value === true);
      if (flags.text) stdout.write(`${JSON.stringify(result.map(entry => entry.item))}\n`);
      else print({ command, result, ...(abstained ? { abstained: evaluated.filter(entry => entry.status === 'abstained') } : {}), meta: output.meta });
    } else {
      result = command === 'decide' ? output.results : output.results[0];
      if (flags.text) {
        const value = command === 'decide' ? output.results.map(entry => entry.value) : result.value;
        stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
      } else print({ command: positionals[0], result, meta: output.meta });
    }
    exitCode = abstained ? 4 : 0;
  } catch (error) {
    exitCode = signal?.aborted ? 130 : error.exitCode ?? (error.code === 'INVALID_INPUT' ? 2 : 1);
    stderr.write(`${JSON.stringify({ error: { code: signal?.aborted ? 'ABORTED' : error.code ?? 'ERROR', message: signal?.aborted ? 'Request canceled.' : error.message } })}\n`);
  }
  process.exitCode = exitCode;
  return exitCode;
}
