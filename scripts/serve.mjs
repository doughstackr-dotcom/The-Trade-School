#!/usr/bin/env node
// Tiny static server that behaves like the Vercel deployment: serves a directory, answers
// extension-less paths (/games/fib-sniper) with index.html, and applies the `headers` and
// `rewrites` of vercel.json (Content-Security-Policy, Cache-Control, …), so the production
// build can be checked locally before it ships. No dependencies.
//
//   node scripts/serve.mjs [dir] [--port=4173] [--no-vercel]    (npm run serve:dist)
//
// Also imported by tests/smoke.mjs (--dist).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Converts a Vercel `source` pattern (path-to-regexp syntax: `:name`, `:name*`, `(regex)`
 * groups, `\\.` escapes) to an anchored RegExp. Covers the forms used in vercel.json.
 */
export function sourceToRegExp(source) {
  let re = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      re += source.slice(i, i + 2);
      i += 1;
    } else if (c === '(') {
      // copy a balanced group verbatim (it is already a regex)
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === '\\') { j += 1; continue; }
        if (source[j] === '(') depth += 1;
        else if (source[j] === ')' && --depth === 0) break;
      }
      re += source.slice(i, j + 1);
      i = j;
    } else if (c === ':') {
      const m = /^:([A-Za-z0-9_]+)([*+?]?)/.exec(source.slice(i));
      re += m[2] === '*' ? '(.*)' : m[2] === '+' ? '(.+)' : m[2] === '?' ? '([^/]*)' : '([^/]+)';
      i += m[0].length - 1;
    } else {
      re += c.replace(/[.*+?^${}|[\]]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** Reads headers / rewrites from vercel.json as matchers. */
export function loadVercelConfig(file = path.join(ROOT, 'vercel.json')) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    headers: (cfg.headers || []).map((r) => ({ re: sourceToRegExp(r.source), headers: r.headers })),
    rewrites: (cfg.rewrites || []).map((r) => ({ re: sourceToRegExp(r.source), destination: r.destination })),
  };
}

/**
 * Starts a server for `dir`. With `vercel`, vercel.json headers and rewrites apply (a file that
 * exists wins over a rewrite, as on Vercel); without, extension-less paths fall back to
 * index.html and everything is served `no-store`. `overlay` maps URL prefixes to extra
 * directories (e.g. test fixtures that are not part of dist/). Resolves { server, port }.
 */
export function startServer({ dir = ROOT, port = 0, host = '127.0.0.1', vercel = false, overlay = {} } = {}) {
  const cfg = vercel ? loadVercelConfig() : null;
  const root = path.resolve(dir);

  function resolveFile(urlPath) {
    for (const [prefix, base] of Object.entries(overlay)) {
      if (urlPath.startsWith(prefix)) {
        const f = path.normalize(path.join(base, urlPath.slice(prefix.length)));
        return f.startsWith(path.resolve(base)) ? f : null;
      }
    }
    const f = path.normalize(path.join(root, urlPath));
    return f.startsWith(root) ? f : null;
  }

  const isFile = (f) => {
    try {
      return !!f && fs.statSync(f).isFile();
    } catch {
      return false;
    }
  };

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const reqPath = decodeURIComponent(url.pathname);
      let servePath = reqPath.endsWith('/') ? `${reqPath}index.html` : reqPath;
      let file = resolveFile(servePath);
      if (file === null) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!isFile(file)) {
        let dest = null;
        if (cfg) dest = cfg.rewrites.find((r) => r.re.test(reqPath))?.destination || null;
        else if (!path.posix.extname(reqPath)) dest = '/index.html';
        if (dest) {
          servePath = dest;
          file = resolveFile(dest);
        }
      }
      if (!isFile(file)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Not found: ${reqPath}`);
        return;
      }
      const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': fs.statSync(file).size,
      };
      if (cfg) {
        // Vercel matches headers against the requested path; later rules override earlier ones.
        for (const rule of cfg.headers) {
          if (!rule.re.test(reqPath)) continue;
          for (const { key, value } of rule.headers) headers[key] = value;
        }
      } else {
        headers['Cache-Control'] = 'no-store';
      }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, port: server.address().port })));
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) || 'dist');
  const port = Number((args.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 4173;
  const vercel = !args.includes('--no-vercel');
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    console.error(`${path.relative(ROOT, dir) || '.'}/index.html not found. Run \`npm run build\` first.`);
    process.exit(1);
  }
  startServer({ dir, port, vercel }).then(({ port: p }) => {
    console.log(`Serving ${path.relative(ROOT, dir) || '.'}/ at http://127.0.0.1:${p}/${vercel ? ' with vercel.json headers' : ''} (Ctrl+C to stop)`);
  });
}
