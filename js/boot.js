import { clearStaleWorkerForFreshBoot } from './sw-cleanup.js';

const moduleVersion = new URL(import.meta.url).search;

if (!(await clearStaleWorkerForFreshBoot())) {
  await import(`./main.js${moduleVersion}`);
  await import(`./pwa.js${moduleVersion}`);
}
