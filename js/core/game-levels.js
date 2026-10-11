// The Arcade campaign is shared by every game. A stage is one short run, not one round.
// Keep the numbers here so the intro, shell, and progress store agree on the same path.
export const CAMPAIGN_LEVEL_COUNT = 40;

export const CAMPAIGN_CHAPTERS = [
  'Opening Bell',
  'Reading the Tape',
  'Signal Search',
  'Decision Time',
  'Under Pressure',
  'Precision Trades',
  'Market Mastery',
  'Final Bell',
];

export function clampCampaignLevel(value) {
  const level = Number(value);
  return Number.isFinite(level) ? Math.max(1, Math.min(CAMPAIGN_LEVEL_COUNT, Math.floor(level))) : 1;
}

export function campaignChapter(level) {
  const index = Math.floor((clampCampaignLevel(level) - 1) / 5);
  return { number: index + 1, name: CAMPAIGN_CHAPTERS[index], checkpoint: clampCampaignLevel(level) % 5 === 0 };
}

/** A short stage grows from three to five rounds and gradually adds time pressure. */
export function campaignProfile(level, baseRounds = 6, { daily = false } = {}) {
  const n = clampCampaignLevel(level);
  const progress = (n - 1) / (CAMPAIGN_LEVEL_COUNT - 1);
  const standardRounds = n <= 10 ? 3 : n <= 25 ? 4 : 5;
  const checkpoint = n % 5 === 0;
  const rounds = daily ? baseRounds : Math.min(baseRounds, 5, standardRounds + (checkpoint ? 1 : 0));
  return {
    level: n,
    rounds,
    timerScale: daily ? 1 : 1.12 - 0.25 * progress - (checkpoint ? 0.06 : 0),
    ...campaignChapter(n),
  };
}

/** Games already use this 0–1 value to pick question pools and scenario complexity. */
export function campaignDifficulty(level, round, rounds) {
  const progress = (clampCampaignLevel(level) - 1) / (CAMPAIGN_LEVEL_COUNT - 1);
  const within = Math.max(0, Math.min(1, (Number(round) - 1) / Math.max(1, Number(rounds) - 1)));
  return Math.min(1, 0.08 + 0.72 * progress + 0.2 * within);
}
