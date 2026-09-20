import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join } from 'node:path';
import { validateRequest } from '../../src/decision.mjs';

export const hash = input => createHash('sha256').update(input).digest('hex');

export async function loadSuite(path) {
  const bytes = await readFile(path);
  const cases = bytes.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error(`Invalid dataset JSON at line ${index + 1}.`); }
  });
  if (!cases.length) throw new Error('The dataset is empty.');
  const ids = new Set();
  for (const item of cases) {
    if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) throw new Error('Dataset IDs must be unique nonempty strings.');
    ids.add(item.id);
    if (!['dev', 'test'].includes(item.split) || !['en', 'zh'].includes(item.language) || typeof item.category !== 'string') throw new Error(`Invalid split/language/category: ${item.id}.`);
    item.request = validateRequest(item.request);
    if (!item.expected || typeof item.expected !== 'object' || Array.isArray(item.expected)) throw new Error(`Expected labels missing: ${item.id}.`);
    if (Object.keys(item.expected).length !== item.request.questions.length) throw new Error(`Gold label count mismatch: ${item.id}.`);
    for (const question of item.request.questions) {
      if (!Object.hasOwn(item.expected, question.id)) throw new Error(`Missing gold label: ${item.id}/${question.id}.`);
      const value = item.expected[question.id];
      if (question.type === 'choice' && !question.options.includes(value)) throw new Error(`Invalid choice gold: ${item.id}.`);
      if (question.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid boolean gold: ${item.id}.`);
      if (question.type === 'score' && (typeof value !== 'number' || !Number.isFinite(value) || value < question.min || value > question.max)) throw new Error(`Invalid score gold: ${item.id}.`);
    }
  }
  return { cases, sha256: hash(bytes), bytes: bytes.length };
}

export function shuffle(items, seed) {
  // Seeded Fisher-Yates; stable across supported Node versions.
  let state = seed >>> 0;
  const random = () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildBatch(cases) {
  if (!cases.length) throw new Error('Cannot build an empty batch.');
  if (cases.length === 1) return {
    request: validateRequest(cases[0].request),
    mapping: cases[0].request.questions.map(q => ({ id: q.id, case_id: cases[0].id, original_id: q.id })),
  };
  const mapping = [];
  const questions = [];
  for (const [index, item] of cases.entries()) {
    for (const question of item.request.questions) {
      const id = `q${questions.length}`;
      questions.push({ ...question, id, prompt: `Use ONLY state.inputs[${index}] as the evidence for this question. Ignore other inputs.\n${question.prompt}` });
      mapping.push({ id, case_id: item.id, original_id: question.id });
    }
  }
  return { request: validateRequest({ state: { inputs: cases.map(item => item.request.state) }, questions }), mapping };
}

export function unpackResults(results, mapping, caseId) {
  const byId = new Map(results.map(result => [result.id, result]));
  return mapping.filter(item => item.case_id === caseId).map(item => {
    const result = byId.get(item.id);
    if (!result) throw new Error(`Missing batch answer: ${item.id}.`);
    return { ...result, id: item.original_id };
  });
}

export async function sourceHashes(root) {
  const paths = ['package.json'];
  const walk = async directory => {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith('.mjs')) paths.push(path);
    }
  };
  await walk('src');
  await walk('experiments/lib');
  await walk('experiments/variants');
  for (const entry of await readdir(join(root, 'experiments'), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) paths.push(join('experiments', entry.name));
  }
  const files = {};
  for (const path of paths.sort()) files[relative(root, resolve(root, path)).replaceAll('\\', '/')] = hash(await readFile(join(root, path)));
  return { sha256: hash(JSON.stringify(files)), files };
}
