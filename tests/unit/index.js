// Lets `node --test tests/unit/` work on Node 22+, which no longer expands a directory argument:
// node resolves the directory to this file, which loads every *.test.mjs next to it (in one
// process). `npm test` (node --test "tests/unit/*.test.mjs") runs the files in parallel instead
// and does not pick this file up.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();
for (const f of files) await import(pathToFileURL(join(here, f)).href);
