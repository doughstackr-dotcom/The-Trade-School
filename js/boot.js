import { clearStaleWorkerForFreshBoot } from './sw-cleanup.js';

if (!(await clearStaleWorkerForFreshBoot())) {
  await import('./main.js');
  await import('./pwa.js');
}
