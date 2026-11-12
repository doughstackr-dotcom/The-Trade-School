// One-off integrity check: every asset URL referenced in sw.js must exist on disk.
import { readFileSync, existsSync } from 'node:fs';
const sw = readFileSync('sw.js', 'utf8');
const urls = [...new Set([...sw.matchAll(/['"`]([a-zA-Z0-9_\-./]+\.(?:js|css|html|png|svg|webmanifest))['"`]/g)].map(m => m[1]))].sort();
const missing = urls.filter(u => !existsSync(u.replace(/^[./]+/, '')));
console.log(`sw.js references ${urls.length} asset files`);
if (missing.length) {
  console.log('MISSING:');
  for (const m of missing) console.log('  ' + m);
  process.exit(1);
}
console.log('all referenced assets exist');
// also check index.html script/link references
const html = readFileSync('index.html', 'utf8');
const refs = [...new Set([...html.matchAll(/(?:src|href)="([a-zA-Z0-9_\-./]+\.(?:js|css|png|svg|webmanifest))"/g)].map(m => m[1]))];
const htmlMissing = refs.filter(u => !existsSync(u.replace(/^[./]+/, '')));
if (htmlMissing.length) {
  console.log('INDEX MISSING:');
  for (const m of htmlMissing) console.log('  ' + m);
  process.exit(1);
}
console.log(`index.html: all ${refs.length} asset refs exist`);
