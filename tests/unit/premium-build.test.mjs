// scripts/build.mjs with PREMIUM_SOURCE=storage: which modules are paid, where they go in the
// `premium` bucket, and what the storage build writes (built into temp directories).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  build, planPremium, premiumFolder, premiumSource, objectPath, PREMIUM_MANIFEST,
} from '../../scripts/build.mjs';
import { LESSONS, GAMES } from '../../js/registry.js';
import { FREE_IDS } from '../../js/config.js';

const graph = (edges) => new Map(Object.entries(edges).map(([f, ds]) => [f, new Set(ds)]));

test('premiumFolder follows requiredPlan(): advanced → advanced/, beginner and both → beginner/', () => {
  assert.equal(premiumFolder({ id: 'a', type: 'lesson', tier: 'advanced', path: './lessons/a.js' }), 'advanced');
  assert.equal(premiumFolder({ id: 'b', type: 'lesson', tier: 'beginner', path: './lessons/b.js' }), 'beginner');
  assert.equal(premiumFolder({ id: 'c', type: 'game', tier: 'both', path: './games/c.js' }), 'beginner');
  assert.equal(premiumFolder({ id: 'c', type: 'game', tier: 'both', path: './games/c.js' }, ['c']), null, 'FREE_IDS stay public');
  assert.equal(premiumFolder({ id: 'd', type: 'lesson', tier: 'beginner', path: './lessons/d.js', dev: true }), null);
  assert.equal(premiumFolder({ id: 'e', type: 'page', tier: 'beginner', path: './pages/e.js' }), null);
  assert.equal(premiumFolder(null), null);
});

test('planPremium: paid entries and their private helpers; shared modules stay public', () => {
  const files = [
    'js/registry.js', 'js/core/ui.js', 'js/core/kit.js',
    'js/lessons/free.js', 'js/lessons/b.js', 'js/lessons/b-visuals.js', 'js/lessons/a.js',
    'js/games/shared-helper.js', 'js/games/adv-only-helper.js', 'js/games/banks/q.js', 'js/games/g.js',
  ];
  const deps = graph({
    'js/registry.js': ['js/lessons/free.js', 'js/lessons/b.js', 'js/lessons/a.js', 'js/games/g.js'],
    'js/lessons/free.js': ['js/core/ui.js', 'js/games/banks/q.js'],
    'js/lessons/b.js': ['js/core/kit.js', 'js/lessons/b-visuals.js', 'js/games/shared-helper.js'],
    'js/lessons/a.js': ['js/core/kit.js', 'js/games/shared-helper.js', 'js/games/adv-only-helper.js'],
    'js/games/g.js': ['js/games/banks/q.js'],
    'js/core/kit.js': ['js/core/ui.js', 'js/registry.js'],
  });
  const entries = [
    { id: 'free', type: 'lesson', tier: 'beginner', path: './lessons/free.js' },
    { id: 'b', type: 'lesson', tier: 'beginner', path: './lessons/b.js' },
    { id: 'a', type: 'lesson', tier: 'advanced', path: './lessons/a.js' },
    { id: 'g', type: 'game', tier: 'both', path: './games/g.js' },
  ];
  const { premium, problems } = planPremium({ files, deps, entries, freeIds: ['free'] });
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.fromEntries(premium), {
    'js/games/adv-only-helper.js': 'advanced',
    'js/games/g.js': 'beginner',
    'js/games/shared-helper.js': 'beginner', // imported by a beginner and an advanced module
    'js/lessons/a.js': 'advanced',
    'js/lessons/b-visuals.js': 'beginner',
    'js/lessons/b.js': 'beginner',
  });
  // core modules (even ones only paid code imports) and banks the free lesson uses are public
  for (const f of ['js/core/kit.js', 'js/core/ui.js', 'js/games/banks/q.js', 'js/lessons/free.js']) assert.ok(!premium.has(f), f);
});

test('planPremium reports a paid module that public code imports, with the chain', () => {
  const files = ['js/registry.js', 'js/pages/home.js', 'js/games/free.js', 'js/games/paid.js'];
  const deps = graph({
    'js/registry.js': ['js/games/free.js', 'js/games/paid.js'],
    'js/games/free.js': ['js/games/paid.js'],
  });
  const entries = [
    { id: 'free', type: 'game', tier: 'both', path: './games/free.js' },
    { id: 'paid', type: 'game', tier: 'advanced', path: './games/paid.js' },
  ];
  const { premium, problems } = planPremium({ files, deps, entries, freeIds: ['free'] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /js\/games\/paid\.js .*js\/games\/free\.js → js\/games\/paid\.js/);
  assert.ok(!premium.has('js/games/paid.js'));
});

test('the real registry: no free module imports paid code; FREE_IDS and banks stay public', () => {
  // Entry split only; the storage build test below checks the real import graph.
  const paid = [...LESSONS, ...GAMES].filter((e) => premiumFolder(e, FREE_IDS));
  const free = [...LESSONS, ...GAMES].filter((e) => !premiumFolder(e, FREE_IDS));
  assert.deepEqual(free.map((e) => e.id).sort(), [...FREE_IDS].sort());
  assert.ok(paid.length > 30);
});

test('objectPath and premiumSource', () => {
  assert.equal(objectPath('beginner', 'js/lessons/volume.0123456789.js'), 'beginner/lessons/volume.0123456789.js');
  assert.equal(premiumSource([], {}), 'site');
  assert.equal(premiumSource([], { PREMIUM_SOURCE: 'storage' }), 'storage');
  assert.equal(premiumSource(['--premium-source=site'], { PREMIUM_SOURCE: 'storage' }), 'site');
  assert.throws(() => premiumSource([], { PREMIUM_SOURCE: 'bucket' }), /site' or 'storage/);
});

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tts-${name}-`));
}

function files(dir) {
  return fs.readdirSync(dir, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => fs.statSync(path.join(dir, f)).isFile());
}

test('storage build: paid modules only in dist-premium/, rewritten for blob: import, deterministic', async () => {
  const out = tmp('dist');
  const prem = tmp('premium');
  const out2 = tmp('dist2');
  const prem2 = tmp('premium2');
  try {
    await build({ source: 'storage', outDir: out, premiumDir: prem, quiet: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(prem, PREMIUM_MANIFEST), 'utf8'));
    const objects = manifest.objects;
    const sources = Object.values(objects);
    const distFiles = files(out);

    // every paid entry is in the manifest, under the folder the bucket policy expects
    for (const e of [...LESSONS, ...GAMES]) {
      const folder = premiumFolder(e, FREE_IDS);
      const rel = `js/${e.path.replace(/^\.\//, '')}`;
      const base = path.posix.basename(rel, '.js');
      const shipped = distFiles.some((f) => f.startsWith(`${path.posix.dirname(rel)}/${base}.`) && /\.[0-9a-f]{10}\.js$/.test(f) && f.split('/').length === rel.split('/').length);
      if (folder) {
        const obj = Object.keys(objects).find((o) => objects[o] === rel);
        assert.ok(obj, `${rel} missing from the premium manifest`);
        assert.ok(obj.startsWith(`${folder}/`), `${rel} → ${obj}, expected ${folder}/…`);
        assert.ok(!shipped, `${rel} must not be in dist/`);
      } else {
        assert.ok(shipped, `free ${rel} must be in dist/`);
      }
    }
    assert.ok(sources.includes('js/lessons/markets-orders-visuals.js'), 'helper only paid code imports is private');
    assert.ok(distFiles.some((f) => f.startsWith('js/games/banks/order-desk-questions.')), 'banks shared with Daily Challenge stay public');
    assert.ok(distFiles.some((f) => f.startsWith('js/core/game-kit.')), 'shared chunks stay public');
    assert.ok(!files(prem).some((f) => f.includes('/core/')), 'no core module in dist-premium/');
    assert.deepEqual(files(prem).filter((f) => f !== PREMIUM_MANIFEST).sort(), Object.keys(objects).sort());

    // paid modules: no relative imports; absolute ones point at files in dist/
    for (const obj of Object.keys(objects)) {
      const code = fs.readFileSync(path.join(prem, obj), 'utf8');
      assert.doesNotMatch(code, /(["'`])\.{1,2}\//, `${obj} has a relative specifier`);
      for (const m of code.matchAll(/(["'`])(\/js\/[^"'`]+\.js)\1/g)) assert.ok(distFiles.includes(m[2].slice(1)), `${obj} → ${m[2]} not in dist/`);
      for (const m of code.matchAll(/(["'`])premium:([^"'`]+)\1/g)) assert.ok(m[2] in objects, `${obj} → premium:${m[2]} not published`);
    }
    const mo = Object.keys(objects).find((o) => objects[o] === 'js/lessons/markets-orders.js');
    assert.match(fs.readFileSync(path.join(prem, mo), 'utf8'), /"premium:beginner\/lessons\/markets-orders-visuals\.[0-9a-f]{10}\.js"/);

    // registry: paid paths are premium: markers; config says storage
    const reg = distFiles.find((f) => /^js\/registry\.[0-9a-f]{10}\.js$/.test(f));
    const regCode = fs.readFileSync(path.join(out, reg), 'utf8');
    for (const obj of Object.keys(objects).filter((o) => !o.includes('markets-orders-visuals'))) assert.ok(regCode.includes(`"premium:${obj}"`) || regCode.includes(`'premium:${obj}'`), `registry lacks premium:${obj}`);
    assert.match(regCode, /["']\.\/lessons\/risk-basics\.[0-9a-f]{10}\.js["']/);
    const cfg = distFiles.find((f) => /^js\/config\.[0-9a-f]{10}\.js$/.test(f));
    assert.match(fs.readFileSync(path.join(out, cfg), 'utf8'), /PREMIUM_SOURCE="storage"/);
    const assets = JSON.parse(fs.readFileSync(path.join(out, 'asset-manifest.json'), 'utf8'));
    for (const rel of sources) assert.ok(!(rel in assets), `${rel} listed in dist/asset-manifest.json`);

    // same source → same names (Vercel's build and the publishing job's build agree)
    await build({ source: 'storage', outDir: out2, premiumDir: prem2, quiet: true });
    assert.equal(fs.readFileSync(path.join(prem2, PREMIUM_MANIFEST), 'utf8'), fs.readFileSync(path.join(prem, PREMIUM_MANIFEST), 'utf8'));
    assert.equal(fs.readFileSync(path.join(out2, 'asset-manifest.json'), 'utf8'), fs.readFileSync(path.join(out, 'asset-manifest.json'), 'utf8'));
  } finally {
    for (const d of [out, prem, out2, prem2]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('default (site) build ships every module publicly and writes no dist-premium/', async () => {
  const out = tmp('dist');
  const prem = tmp('premium');
  try {
    await build({ source: 'site', outDir: out, premiumDir: prem, quiet: true });
    assert.ok(!fs.existsSync(prem));
    const distFiles = files(out);
    for (const e of [...LESSONS, ...GAMES]) {
      const rel = `js/${e.path.replace(/^\.\//, '')}`;
      assert.ok(distFiles.some((f) => f.startsWith(rel.slice(0, -3) + '.')), `${rel} missing`);
    }
    for (const f of distFiles.filter((x) => x.endsWith('.js'))) assert.doesNotMatch(fs.readFileSync(path.join(out, f), 'utf8'), /["'`]premium:(?:beginner|advanced)\//, f);
    const cfg = distFiles.find((f) => /^js\/config\.[0-9a-f]{10}\.js$/.test(f));
    assert.match(fs.readFileSync(path.join(out, cfg), 'utf8'), /PREMIUM_SOURCE="site"/);
  } finally {
    for (const d of [out, prem]) fs.rmSync(d, { recursive: true, force: true });
  }
});
