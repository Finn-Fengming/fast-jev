import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inputError } from './errors.mjs';
import { validateProviderOptions } from './providers.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, label) {
  if (!object(value)) throw inputError(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw inputError(`Unknown ${label} field: ${key}`);
}

export async function resolveConfig(flags = {}, env = process.env) {
  const explicit = flags.config ?? env.FAST_JEV_CONFIG;
  const path = explicit ?? join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'fast-jev', 'config.json');
  let config = {};
  try { config = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || explicit) throw inputError(`Cannot read config ${path}: ${error instanceof SyntaxError ? 'invalid JSON' : error.code ?? 'read failed'}`);
  }
  keys(config, ['provider', 'timeoutMs', 'agy', 'openai'], 'config');
  if (config.agy !== undefined) keys(config.agy, ['model', 'agyBin', 'effort'], 'config.agy');
  if (config.openai !== undefined) keys(config.openai, ['model', 'baseUrl', 'apiKeyEnv', 'responseFormat', 'effort', 'maxTokens'], 'config.openai');
  for (const name of ['agy', 'openai']) {
    for (const [key, value] of Object.entries(config[name] ?? {})) {
      if (key === 'maxTokens') {
        if (!Number.isInteger(value) || value < 1) throw inputError(`config.${name}.${key} must be a positive integer.`);
      } else if (typeof value !== 'string' || !value.trim()) throw inputError(`config.${name}.${key} must be a nonempty string.`);
    }
  }
  const provider = flags.provider ?? env.FAST_JEV_PROVIDER ?? config.provider ?? 'agy';
  const incompatible = provider === 'agy' ? ['base-url', 'response-format', 'max-tokens'] : provider === 'openai' ? ['agy-bin'] : [];
  for (const key of incompatible) if (flags[key] !== undefined) throw inputError(`--${key} does not apply to provider ${provider}. Select the correct --provider.`);
  const scoped = config[provider] ?? {};
  const options = {
    ...scoped, provider,
    model: flags.model ?? env.FAST_JEV_MODEL ?? scoped.model,
    timeoutMs: flags.timeout === undefined ? (env.FAST_JEV_TIMEOUT_MS === undefined ? config.timeoutMs : Number(env.FAST_JEV_TIMEOUT_MS)) : Number(flags.timeout),
    effort: flags.effort ?? env.FAST_JEV_EFFORT ?? scoped.effort,
  };
  if (provider === 'agy') options.agyBin = flags['agy-bin'] ?? env.FAST_JEV_AGY_BIN ?? scoped.agyBin ?? 'agy';
  if (provider === 'openai') {
    options.baseUrl = flags['base-url'] ?? env.OPENAI_BASE_URL ?? scoped.baseUrl;
    options.responseFormat = flags['response-format'] ?? env.FAST_JEV_RESPONSE_FORMAT ?? scoped.responseFormat;
    options.maxTokens = flags['max-tokens'] === undefined ? scoped.maxTokens : Number(flags['max-tokens']);
    const keyName = scoped.apiKeyEnv ?? 'OPENAI_API_KEY';
    if (typeof keyName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyName)) throw inputError('apiKeyEnv must be an environment variable name.');
    options.apiKey = env.FAST_JEV_API_KEY ?? env[keyName];
  }
  return validateProviderOptions(options);
}
