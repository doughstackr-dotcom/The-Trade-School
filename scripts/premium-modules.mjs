import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES, LESSONS, TOOLS } from '../js/registry.js';
import { FREE_IDS } from '../js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function planForEntry(entry) {
  if (FREE_IDS.includes(entry.id)) return null;
  if (entry.tier === 'advanced') return 'advanced';
  if (entry.tier === 'beginner' || entry.tier === 'both') return 'beginner';
  return null;
}

function publicRel(entry) {
  return entry.path.replace(/^\.\//, 'js/');
}

async function sameFolderDeps(rel) {
  let source = '';
  try {
    source = await readFile(path.join(ROOT, rel), 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  const dir = path.dirname(rel).replaceAll('\\', '/');
  const deps = [];
  const re = /\bfrom\s*['"](\.\/[^'"]+)['"]|\bimport\s*['"](\.\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(re)) {
    const specifier = match[1] || match[2] || match[3];
    const dep = path.posix.normalize(`${dir}/${specifier.slice(2)}`);
    if (!dep.startsWith('../')) deps.push(dep);
  }
  return deps;
}

async function addModule(modules, plan, rel) {
  const storagePath = `${plan}/${rel.replace(/^js\//, '')}`;
  if (modules.has(storagePath)) return;
  modules.set(storagePath, rel);
  for (const dep of await sameFolderDeps(rel)) {
    await addModule(modules, plan, dep);
  }
}

export async function premiumModules() {
  const modules = new Map();
  for (const entry of [...LESSONS, ...GAMES, ...TOOLS]) {
    const plan = planForEntry(entry);
    if (!plan) continue;
    await addModule(modules, plan, publicRel(entry));
  }
  return [...modules].map(([storagePath, rel]) => ({
    storagePath,
    localPath: path.join(ROOT, rel),
    publicPath: rel,
  })).sort((a, b) => a.storagePath.localeCompare(b.storagePath));
}
