// Affiliate partners — trading platforms / tools with referral links.
// Fill PARTNERS entries to publish; do not invent broker URLs or logos.
import { h, icon } from '../core/ui.js';

/**
 * Partner slots. Edit this array to add real affiliates later.
 * - name: display name
 * - description: short blurb (owner-editable)
 * - category: grouping key matching CATEGORIES
 * - logoText / logoUrl: optional monogram or image URL (null = placeholder)
 * - affiliateUrl: exact referral href, or null / '' for TBD (CTA disabled)
 * - status: 'live' | 'coming' — coming slots show “Coming soon / Partner TBD”
 */
export const PARTNERS = [
  {
    id: 'pocket-option',
    name: 'Pocket Option',
    category: 'brokers',
    description: 'Affiliate partner — short description coming soon. Replace this copy with an accurate product blurb.',
    logoText: 'PO',
    logoUrl: 'assets/affiliates/pocket-option.png',
    affiliateUrl: 'https://pocket-friends.co/r/zs9a40s5v6',
    status: 'live',
  },
  {
    id: 'robinhood',
    name: 'Robinhood',
    category: 'brokers',
    description: 'Affiliate partner — replace this placeholder with an accurate product blurb.',
    logoText: null,
    logoUrl: 'assets/affiliates/robinhood.svg',
    affiliateUrl: 'https://join.robinhood.com/rehnes',
    status: 'live',
  },
  {
    id: 'public',
    name: 'Public',
    category: 'brokers',
    description: 'Affiliate partner — replace this placeholder with an accurate product blurb.',
    logoText: null,
    logoUrl: 'assets/affiliates/public.svg',
    affiliateUrl: 'https://public.com/user-referral?referrer=Rehne82057',
    status: 'live',
  },
  {
    id: 'webull',
    name: 'Webull',
    category: 'brokers',
    description: 'Affiliate partner — replace this placeholder with an accurate product blurb.',
    logoText: null,
    logoUrl: 'assets/affiliates/webull.svg',
    affiliateUrl: 'https://www.webull.com/s/3Kh5mWpood8i1GGOz9',
    status: 'live',
  },
  {
    id: 'upcomers',
    name: 'Upcomers',
    category: 'funded',
    description: 'Upcomers is a funded trading account platform.',
    logoText: null,
    logoUrl: 'assets/affiliates/upcomers.svg',
    affiliateUrl: 'https://app.upcomers.com/en/checkout?ref=gy4xupgr',
    status: 'live',
  },
  {
    id: 'partner-tbd-2',
    name: 'Partner TBD',
    category: null,
    description: 'Coming soon — another trading platform or tool partnership will land here.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: null,
    status: 'coming',
  },
  {
    id: 'partner-tbd-3',
    name: 'Partner TBD',
    category: null,
    description: 'Coming soon — placeholder slot for a future affiliate link.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: null,
    status: 'coming',
  },
  {
    id: 'partner-tbd-4',
    name: 'Partner TBD',
    category: null,
    description: 'Coming soon — placeholder slot for a future affiliate link.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: null,
    status: 'coming',
  },
];

/** Section headings for live partners (order = display order). */
export const CATEGORIES = [
  { id: 'brokers', title: 'Brokers & apps', blurb: 'Brokerages and investing apps with referral links.' },
  { id: 'funded', title: 'Funded accounts', blurb: 'Prop / funded-account platforms.' },
];

function logoSlot(p, { compact = false } = {}) {
  const base = compact ? 'aff-soon__logo' : 'aff-row__logo';
  if (p.logoUrl) {
    return h('div', { class: `${base} ${base}--img`, 'aria-hidden': 'true' },
      h('img', {
        class: compact ? 'aff-soon__logo-img' : 'aff-row__logo-img',
        src: p.logoUrl,
        alt: '',
        width: compact ? 36 : 48,
        height: compact ? 36 : 48,
        loading: 'lazy',
        decoding: 'async',
      }));
  }
  if (p.logoText) {
    return h('div', {
      class: `${base} ${base}--mono`,
      'aria-hidden': 'true',
    }, p.logoText);
  }
  return h('div', {
    class: `${base} ${base}--empty`,
    'aria-hidden': 'true',
  }, icon('layers', { size: compact ? 16 : 20 }));
}

function cta(p) {
  const url = typeof p.affiliateUrl === 'string' ? p.affiliateUrl.trim() : '';
  if (url && url !== '#') {
    return h('a', {
      class: 'btn btn--primary aff-row__cta',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer sponsored',
      'data-no-route': '',
    }, 'Visit partner', icon('arrow-right', { size: 14 }));
  }
  return h('button', {
    type: 'button',
    class: 'btn aff-row__cta',
    disabled: true,
    title: 'Affiliate link not added yet',
  }, 'Add link');
}

function partnerRow(p, index) {
  const n = String(index).padStart(2, '0');
  return h('article', {
    class: 'aff-row card',
    id: `aff-${p.id}`,
  },
  h('div', { class: 'aff-row__index', 'aria-hidden': 'true' }, n),
  logoSlot(p),
  h('div', { class: 'aff-row__body' },
    h('div', { class: 'aff-row__titles' },
      h('h3', { class: 'aff-row__name' }, p.name),
      h('span', { class: 'chip chip--sm chip--accent' }, 'Partner')),
    h('p', { class: 'aff-row__desc' }, p.description)),
  h('div', { class: 'aff-row__action' }, cta(p)));
}

function comingTile(p) {
  return h('article', {
    class: 'aff-soon__tile',
    id: `aff-${p.id}`,
  },
  logoSlot(p, { compact: true }),
  h('div', { class: 'aff-soon__meta' },
    h('span', { class: 'aff-soon__name' }, p.name),
    h('span', { class: 'chip chip--sm chip--outline' }, 'Coming soon')),
  h('p', { class: 'aff-soon__note faint' }, 'Partner TBD'));
}

function categorySection(cat, partners, startIndex) {
  let i = startIndex;
  const rows = partners.map((p) => {
    i += 1;
    return partnerRow(p, i);
  });
  return {
    nextIndex: i,
    el: h('section', {
      class: 'aff-section',
      'aria-labelledby': `aff-cat-${cat.id}`,
    },
    h('header', { class: 'aff-section__head' },
      h('h2', { class: 'aff-section__title', id: `aff-cat-${cat.id}` }, cat.title),
      cat.blurb ? h('p', { class: 'aff-section__blurb muted' }, cat.blurb) : null),
    h('div', { class: 'aff-rail', role: 'list' },
      rows.map((row) => h('div', { role: 'listitem' }, row)))),
  };
}

export default {
  id: 'platforms',
  mount(root) {
    const live = PARTNERS.filter((p) => p.status === 'live');
    const coming = PARTNERS.filter((p) => p.status !== 'live');

    const sections = [];
    let index = 0;
    for (const cat of CATEGORIES) {
      const inCat = live.filter((p) => p.category === cat.id);
      if (!inCat.length) continue;
      const { el, nextIndex } = categorySection(cat, inCat, index);
      index = nextIndex;
      sections.push(el);
    }

    // Any live partners without a known category still render.
    const orphan = live.filter((p) => !CATEGORIES.some((c) => c.id === p.category));
    if (orphan.length) {
      const { el, nextIndex } = categorySection(
        { id: 'other', title: 'Partners', blurb: null },
        orphan,
        index,
      );
      index = nextIndex;
      sections.push(el);
    }

    root.append(h('div', { class: 'container affiliate' },
      h('header', { class: 'page-head aff-intro' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Partners'),
        h('h1', null, 'Platforms'),
        h('p', { class: 'lead' },
          'Platforms and tools we partner with. Some links below are affiliate / referral links — '
          + 'if you sign up through them, The Trade School may earn a commission at no extra cost to you.')),
      h('section', {
        class: 'aff-partners',
        'aria-labelledby': 'aff-trading-platforms',
      },
        h('header', { class: 'aff-section__head' },
          h('h2', { class: 'aff-section__title', id: 'aff-trading-platforms' }, 'Trading platforms')),
        ...sections),
      coming.length
        ? h('section', {
          class: 'aff-section aff-section--soon',
          'aria-labelledby': 'aff-cat-soon',
        },
        h('header', { class: 'aff-section__head' },
          h('h2', { class: 'aff-section__title', id: 'aff-cat-soon' }, 'Coming soon'),
          h('p', { class: 'aff-section__blurb muted' },
            'Partner TBD — more trading platforms and tools will land here.')),
        h('div', { class: 'aff-soon', role: 'list' },
          coming.map((p) => h('div', { role: 'listitem' }, comingTile(p)))))
        : null,
      h('div', { class: 'callout callout--warn aff-disclaimer', role: 'note' },
        icon('info', { size: 18 }),
        h('div', null,
          h('p', null, h('strong', null, 'Affiliate disclosure.')),
          h('p', { class: 'muted' },
            'These are educational partnerships, not endorsements. Always do your own research, '
            + 'read each platform’s terms, and never risk money you cannot afford to lose.'))),
      h('aside', {
        class: 'aff-risk',
        role: 'alert',
        'aria-label': 'Risk and educational disclaimer',
      },
        h('p', { class: 'aff-risk__text' },
          'This is not financial advice. The Trade School is educational material only. '
          + 'Trade at your own risk.'))));
  },
};
