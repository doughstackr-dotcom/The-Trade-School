// The Candle Sensei (v2): a candle mascot in the brand-mark style.
// PURE RENDERING here (no store import — store.js and game-kit.js pull senseiSVG in,
// so this module must stay leaf-level). Pages wire reactions via wireSensei().
import { svg } from './ui.js';

// Educational one-liners, rotated in the map guide and the header tap.
const LEVEL_LINES = [
  'A level is a zone, not a razor line.',
  'First touch teaches. Second touch confirms.',
  'Round numbers attract orders like lights attract moths.',
];

export const SENSEI_TIPS = [
  'Trend, level, trigger — in that order.',
  'A wick through a level is a question. A close beyond it is an answer.',
  'Your stop belongs where the idea is wrong, not where it feels safe.',
  'Volume is the crowd’s conviction — weigh it.',
  'Two reasons or no trade. Confluence pays; hope does not.',
  'The best trade you skip on a bad day costs nothing.',
  'Higher timeframe for direction. Lower timeframe only for timing.',
  'Divergence warns. Structure confirms.',
  'Risk the same slice every time — survival is the real edge.',
  'A pattern without context is just a doodle.',
  'Missing a move costs zero. Catching a fakeout costs R.',
  'Journal the trades you did not take, too.',
  ...LEVEL_LINES,
];

/**
 * The Sensei as inline SVG. mood: idle | cheer | wince | zen | fire. hat: none | cap |
 * crown | shades (cosmetics ids hat-*; anything else renders bare). Colors ride CSS vars
 * (.sensei classes in components.css) so cabinet skins recolour him too.
 */
export function senseiSVG({ size = 64, mood = 'idle', hat = 'none', label = null } = {}) {
  const eyes = {
    idle: [svg('circle', { cx: 27, cy: 28, r: 1.9, class: 'sensei__ink' }), svg('circle', { cx: 37, cy: 28, r: 1.9, class: 'sensei__ink' })],
    cheer: [svg('path', { d: 'M25 29 q2 -3.4 4 0', class: 'sensei__stroke' }), svg('path', { d: 'M35 29 q2 -3.4 4 0', class: 'sensei__stroke' })],
    wince: [svg('path', { d: 'M25.5 28 h3.5', class: 'sensei__stroke' }), svg('path', { d: 'M35 28 h3.5', class: 'sensei__stroke' })],
    zen: [svg('path', { d: 'M25 28 q2 2.4 4 0', class: 'sensei__stroke' }), svg('path', { d: 'M35 28 q2 2.4 4 0', class: 'sensei__stroke' })],
    fire: [
      svg('path', { d: 'M27 26 l1.6 2 -1.6 2 -1.6-2 z', class: 'sensei__ink' }),
      svg('path', { d: 'M37 26 l1.6 2 -1.6 2 -1.6-2 z', class: 'sensei__ink' }),
    ],
  }[mood] || [];
  const mouth = {
    idle: svg('path', { d: 'M28.5 38 q3.5 2.6 7 0', class: 'sensei__stroke' }),
    cheer: svg('path', { d: 'M27.5 37 q4.5 5.6 9 0', class: 'sensei__stroke' }),
    wince: svg('path', { d: 'M28 39 q1.6 -2 3.2 0 q1.6 2 3.2 0', class: 'sensei__stroke' }),
    zen: svg('path', { d: 'M29.5 39 h5', class: 'sensei__stroke' }),
    fire: svg('circle', { cx: 32, cy: 39, r: 2.4, class: 'sensei__ink' }),
  }[mood] || svg('path', { d: 'M29 39 h6', class: 'sensei__stroke' });

  const hats = {
    cap: [
      svg('path', { d: 'M23 15 q9 -8 18 0 z', class: 'sensei__hat' }),
      svg('path', { d: 'M22 15 h22 v1.6 h-22 z', class: 'sensei__hat' }),
    ],
    crown: [svg('path', { d: 'M25 12 l3 -4 4 3 4 -3 3 4 v3 h-14 z', class: 'sensei__hat sensei__hat--gold' })],
    shades: [svg('path', { d: 'M23.5 26.5 h17 v3.4 h-17 z', class: 'sensei__hat sensei__hat--dark' })],
  };
  const hatParts = hats[hat] || [];

  return svg('svg', {
    class: `sensei sensei--${mood}`,
    width: size,
    height: size,
    viewBox: '0 0 64 64',
    focusable: 'false',
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }),
  },
    svg('path', { d: 'M32 3v8', class: 'sensei__wick' }),
    svg('path', { d: 'M32 53v8', class: 'sensei__wick' }),
    svg('rect', { x: 21.5, y: 11, width: 21, height: 42, rx: 3.4, class: 'sensei__body' }),
    ...hatParts,
    ...eyes,
    mouth);
}

/**
 * Wires mascot moods to progress + gameplay. setMood(mood) is called with a temporary
 * reaction (returns to idle after `ms`). Listens to store events plus the DOM game
 * events game-kit dispatches (tts:hit / tts:miss). Returns an unwire function.
 */
export function wireSensei(store, setMood) {
  let timer = 0;
  let idleMood = 'idle';
  const react = (mood, ms = 1400) => {
    setMood(mood);
    clearTimeout(timer);
    timer = setTimeout(() => setMood(idleMood), ms);
  };
  const onXP = () => react('cheer', 900);
  const onBadge = () => react('fire', 2200);
  const onLevel = () => { idleMood = 'fire'; react('fire', 3000); setTimeout(() => { idleMood = 'idle'; }, 8000); };
  const onHit = (e) => { if (e.detail?.streak >= 3) react('fire', 1200); else react('cheer', 800); };
  const onMiss = () => react('wince', 1300);

  store.on?.('xp', onXP);
  store.on?.('badge', onBadge);
  store.on?.('level', onLevel);
  document.addEventListener('tts:hit', onHit);
  document.addEventListener('tts:miss', onMiss);
  return () => {
    clearTimeout(timer);
    store.off?.('xp', onXP);
    store.off?.('badge', onBadge);
    store.off?.('level', onLevel);
    document.removeEventListener('tts:hit', onHit);
    document.removeEventListener('tts:miss', onMiss);
  };
}

/** A rotating tip (deterministic per day, so the map guide feels alive but stable). */
export function tipOfTheDay(date = new Date()) {
  const seed = date.getFullYear() * 372 + date.getMonth() * 31 + date.getDate();
  return SENSEI_TIPS[seed % SENSEI_TIPS.length];
}
