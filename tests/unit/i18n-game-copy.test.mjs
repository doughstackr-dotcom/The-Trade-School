import test from 'node:test';
import assert from 'node:assert/strict';

test('Spanish game copy translates dynamic level numbers and chapter names', async () => {
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: (key) => key === 'tts-language' ? 'es' : null };
  try {
    const { translate } = await import('../../js/core/i18n.js');
    assert.equal(translate('Level 37 · Final Bell'), 'Nivel 37 · Cierre');
    assert.equal(translate('Clear 5 rounds and earn one star to unlock the next level.'),
      'Supera 5 rondas y consigue una estrella para desbloquear el siguiente nivel.');
    assert.equal(translate('Level 23/40'), 'Nivel 23/40');
    assert.equal(translate('· Head and shoulders. This is a plan based on evidence, not a guarantee.'),
      '· Cabeza y hombros. Es un plan basado en señales, no una garantía.');
    assert.equal(translate('Lean up from Head and shoulders. Not a guarantee.'),
      'Sesgo alcista según Cabeza y hombros. No es una garantía.');
    assert.equal(translate('Sample follow-through: followed.'),
      'Evolución posterior de ejemplo: continuó.');
    assert.equal(translate('. Sample outcome: followed (1.5 ATR). Measured targets are guidelines.'),
      '. Resultado de ejemplo: continuó (1.5 ATR). Los objetivos proyectados son orientativos.');
  } finally {
    if (oldStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = oldStorage;
  }
});
