import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const DEFAULT_MODEL = 'gemini-3.8-flash-low';
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export class AgyError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'AgyError';
    this.code = code;
    this.exitCode = ({ AGY_TIMEOUT: 124, ABORTED: 130, AGY_CONFIG: 2 })[code] ?? 1;
  }
}

function validateOptions({ agyBin, timeoutMs, signal, maxBuffer }) {
  if (typeof agyBin !== 'string' || !agyBin.trim() || agyBin.includes('\0')) {
    throw new AgyError('AGY_CONFIG', 'agyBin must be a command name or executable path.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new AgyError('AGY_CONFIG', 'timeoutMs must be a positive integer.');
  }
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1) {
    throw new AgyError('AGY_CONFIG', 'maxBuffer must be a positive integer.');
  }
  if (signal?.aborted) throw new AgyError('ABORTED', 'AGY request was canceled.');
  // Resolve relative executable paths before changing to the temporary workspace.
  return !isAbsolute(agyBin) && /[/\\]/.test(agyBin) ? resolve(agyBin) : agyBin;
}

function diagnostic(value) {
  return String(value ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim().slice(0, 1800);
}

function runProcess(binary, args, { cwd, input = '', timeoutMs, signal, maxBuffer, onLine }) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new AgyError('ABORTED', 'AGY request was canceled.'));
      return;
    }
    let child;
    let stdout = '';
    let stderr = '';
    let pending = '';
    let totalBytes = 0;
    let failure;
    let settled = false;
    let forceTimer;
    let timeout;
    const group = process.platform !== 'win32';
    const kill = (name) => {
      if (!child?.pid) return;
      try {
        if (group) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) {
        if (error.code !== 'ESRCH') child.kill(name);
      }
    };
    const stop = (error) => {
      if (failure || settled) return;
      failure = error;
      kill('SIGTERM');
      forceTimer = setTimeout(() => kill('SIGKILL'), 250);
      forceTimer.unref();
    };
    const abort = () => stop(new AgyError('ABORTED', 'AGY request was canceled.'));
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolvePromise(result);
    };
    try {
      child = spawn(binary, args, {
        cwd, shell: false, detached: group, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(new AgyError('AGY_START', `Could not start AGY: ${error.message}`, { cause: error }));
      return;
    }
    timeout = setTimeout(() => stop(new AgyError('AGY_TIMEOUT', `AGY exceeded the ${timeoutMs} ms timeout. Check your AGY login/network or increase --timeout.`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const read = (chunk, stream) => {
      if (failure) return;
      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > maxBuffer) {
        stop(new AgyError('AGY_OUTPUT_LIMIT', `AGY output exceeded the ${maxBuffer} byte limit.`));
        return;
      }
      if (stream === 'stderr') {
        stderr += chunk;
        return;
      }
      stdout += chunk;
      if (!onLine) return;
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (!line) continue;
        try { onLine(line); } catch (error) { stop(error); break; }
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => read(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => read(chunk, 'stderr'));
    child.on('error', (error) => {
      const message = error.code === 'ENOENT'
        ? `AGY executable not found: ${binary}. Install AGY, sign in, and ensure it is on PATH (or set agyBin).`
        : `Could not start AGY: ${error.message}`;
      finish(new AgyError(error.code === 'ENOENT' ? 'AGY_NOT_FOUND' : 'AGY_START', message, { cause: error }));
    });
    child.on('close', (code, exitSignal) => {
      if (!failure && onLine && pending.trim()) {
        try { onLine(pending.trim()); } catch (error) { failure = error; }
      }
      finish(failure, { stdout, stderr, code, exitSignal });
    });
    // A process may exit before consuming stdin; its exit envelope is the useful error.
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
        stop(new AgyError('AGY_STDIN', `Could not send the prompt to AGY: ${error.message}`));
      }
    });
    child.stdin.end(input);
  });
}

/** Run one decision using the existing AGY installation and its cached credentials. */
export async function runAgy({
  prompt, schema, model = DEFAULT_MODEL, effort, timeoutMs = 60_000,
  agyBin = 'agy', signal, maxBuffer = MAX_OUTPUT_BYTES,
} = {}) {
  const binary = validateOptions({ agyBin, timeoutMs, signal, maxBuffer });
  if (typeof prompt !== 'string' || !prompt.trim()) throw new AgyError('AGY_CONFIG', 'prompt must be a non-empty string.');
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new AgyError('AGY_CONFIG', 'schema must be a JSON schema object.');
  if (typeof model !== 'string' || !model.trim()) throw new AgyError('AGY_CONFIG', 'model must be a non-empty model slug from agy models.');
  if (effort !== undefined && !['low', 'medium', 'high'].includes(effort)) throw new AgyError('AGY_CONFIG', 'effort must be low, medium, or high.');
  const workspace = await mkdtemp(join(tmpdir(), 'fast-jev-agy-'));
  try {
    const schemaPath = join(workspace, 'schema.json');
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    // Candidate: AGY 1.2.1 documents excluding default prompt components and
    // built-in tools. This per-request customization keeps user settings/auth
    // and post-invocation hooks intact; actual tool exposure needs live verification.
    const agentDirectory = join(workspace, '.agents', 'agents', 'fast-jev');
    await mkdir(agentDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(agentDirectory, 'agent.md'), `---
name: fast-jev
description: Evaluate the supplied decision request.
mainAgent: true
subagent: false
tools: []
inheritMcp: false
excludeDefaultComponents: true
commandExecutionPolicy: 'off'
skills: []
rules: []
---
# System Prompt
Evaluate only the supplied state and questions. Return the requested structured output.
`, { mode: 0o600 });
    const args = [
      '--mode', 'plan', '--sandbox', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--disable-slash-commands', '--json-schema', schemaPath, '--model', model, '--agent', 'fast-jev',
      '--print-timeout', `${timeoutMs}ms`,
    ];
    if (effort !== undefined) args.push('--effort', effort);
    const results = [];
    let init;
    const outcome = await runProcess(binary, args, {
      cwd: workspace, timeoutMs, signal, maxBuffer,
      input: `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`,
      onLine(line) {
        let event;
        try { event = JSON.parse(line); } catch {
          throw new AgyError('AGY_PROTOCOL', 'AGY returned invalid stream JSON. Run fast-jev doctor and update AGY if needed.');
        }
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new AgyError('AGY_PROTOCOL', 'AGY returned an invalid stream event.');
        if (event.event === 'init') {
          init = event.init;
          if (!init || typeof init !== 'object' || Array.isArray(init)) throw new AgyError('AGY_PROTOCOL', 'AGY returned an invalid init event.');
        } else if (event.event === 'result') results.push(event.result);
      },
    });
    const envelope = results.at(-1);
    if (outcome.code !== 0 || envelope?.status !== 'SUCCESS') {
      const reason = diagnostic(envelope?.error || outcome.stderr) || `status ${envelope?.status ?? 'missing'}, exit ${outcome.code ?? outcome.exitSignal}`;
      throw new AgyError('AGY_FAILED', `AGY failed: ${reason}`);
    }
    if (results.length !== 1 || !init) throw new AgyError('AGY_PROTOCOL', 'AGY must return one init event and exactly one successful result.');
    if (!Object.hasOwn(envelope, 'structured_output')) throw new AgyError('AGY_PROTOCOL', 'AGY succeeded without structured_output. Update AGY or check --json-schema support.');
    return {
      data: envelope.structured_output,
      usage: envelope.usage && typeof envelope.usage === 'object' ? envelope.usage : null,
      backendDurationMs: Number.isFinite(envelope.duration_seconds) ? Math.round(envelope.duration_seconds * 1000) : null,
      model,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Inspect AGY without an inference; models may still contact AGY's service. */
export async function probeAgy({ agyBin = 'agy', timeoutMs = 15_000, signal, maxBuffer = MAX_OUTPUT_BYTES } = {}) {
  const binary = validateOptions({ agyBin, timeoutMs, signal, maxBuffer });
  const workspace = await mkdtemp(join(tmpdir(), 'fast-jev-probe-'));
  try {
    const outcomes = await Promise.allSettled([['--version'], ['--help'], ['models']].map((args) =>
      runProcess(binary, args, { cwd: workspace, timeoutMs, signal, maxBuffer })));
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    const [versionRun, helpRun, modelsRun] = outcomes.map((outcome) => outcome.value);
    for (const [name, run] of [['--version', versionRun], ['--help', helpRun], ['models', modelsRun]]) {
      if (run.code !== 0) throw new AgyError('AGY_FAILED', `AGY ${name} failed: ${diagnostic(run.stderr) || `exit ${run.code}`}`);
    }
    const help = `${helpRun.stdout}\n${helpRun.stderr}`;
    return {
      version: versionRun.stdout.trim() || versionRun.stderr.trim(),
      models: [...new Set(modelsRun.stdout.split(/\r?\n/).map((line) => line.trim().match(/^([\w.:/-]+)(?:\s|$)/)?.[1]).filter(Boolean))],
      capabilities: [...new Set([...help.matchAll(/^\s+(--[a-z][a-z-]*)\b/gm)].map((match) => match[1]))].sort(),
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
