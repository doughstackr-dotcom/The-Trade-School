// Candle Credits catalogue (v2): cosmetics the shop sells for tokens.
// PURE DATA + pure helpers — importable from node (tests) and the browser alike.
// Tokens mint 1:1 with XP earned; lifetime XP (never spent) keeps driving levels.

/**
 * Every item: { id, slot, name, blurb, price, swatch: [c1, c2] }.
 * price 0 = owned by everyone (the default look). Slots:
 *   skin   — cabinet skin, applied as <html data-skin>
 *   candles— candle palette, applied as <body data-candles> (scoped to charts in CSS)
 *   frame  — XP pill frame, applied as <body data-frame>
 */
export const COSMETICS = [
  { id: 'midnight', slot: 'skin', name: 'Midnight Arcade', blurb: 'The house cabinet: neon cyan on deep navy CRT.', price: 0, swatch: ['#060B14', '#35E0FF'] },
  { id: 'synthwave', slot: 'skin', name: 'Synthwave', blurb: 'Magenta sunsets and chrome grids.', price: 500, swatch: ['#120726', '#FF5CC8'] },
  { id: 'gameboy', slot: 'skin', name: 'Gameboy', blurb: 'Four shades of green, the way the handheld saw markets.', price: 400, swatch: ['#0B1A0B', '#8FAC6B'] },
  { id: 'blueprint', slot: 'skin', name: 'Blue Print', blurb: 'Drafting-table blues; the chart as a schematic.', price: 400, swatch: ['#0A1E3C', '#7EB3FF'] },

  { id: 'classic', slot: 'candles', name: 'Neon Classic', blurb: 'Standard bull green and bear red.', price: 0, swatch: ['#29F29C', '#FF5C6E'] },
  { id: 'pastel', slot: 'candles', name: 'Pastel Tape', blurb: 'Soft mint and blush candles.', price: 250, swatch: ['#7BE0C3', '#F49BB4'] },
  { id: 'mono', slot: 'candles', name: 'Mono Desk', blurb: 'Cool greys — read the shape, not the colour.', price: 200, swatch: ['#C9D4E8', '#8899B8'] },
  { id: 'fire', slot: 'candles', name: 'Fire Print', blurb: 'Amber and ember candles on a hot tape.', price: 350, swatch: ['#FFC24D', '#FF6B35'] },

  { id: 'frame-classic', slot: 'frame', name: 'Standard Frame', blurb: 'The stock XP readout.', price: 0, swatch: ['#35E0FF', '#FF4FD8'] },
  { id: 'frame-gold', slot: 'frame', name: 'Gold Frame', blurb: 'A gilded pill for gilded totals.', price: 300, swatch: ['#F2B53A', '#8A5A00'] },
  { id: 'frame-arcade', slot: 'frame', name: 'Coin Slot Frame', blurb: 'Insert coin to continue.', price: 250, swatch: ['#FF4FD8', '#35E0FF'] },
];

export const SLOT_LABEL = {
  skin: 'Cabinet skins',
  candles: 'Candle palettes',
  frame: 'XP frames',
};

export const SLOT_BLURB = {
  skin: 'Whole-cabinet colourways. Applies instantly, everywhere.',
  candles: 'Bull and bear colours for the charts (the rest of the desk keeps its semantics).',
  frame: 'Dress up the XP readout in the header.',
};

const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export function findCosmetic(id) {
  return BY_ID.get(id) || null;
}

/** All items for a slot, cheapest first. */
export function cosmeticsOf(slot) {
  return COSMETICS.filter((c) => c.slot === slot).sort((a, b) => a.price - b.price);
}

/** The default (price 0) item id for a slot. */
export function defaultOf(slot) {
  return COSMETICS.find((c) => c.slot === slot && c.price === 0)?.id || null;
}

/** Equipped-id validation used by the store when applying saved progress. */
export function isEquippable(id) {
  return BY_ID.has(id);
}
