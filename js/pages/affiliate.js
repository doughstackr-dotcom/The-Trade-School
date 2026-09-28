// Affiliate partners — trading platforms / tools with referral links.
// Fill PARTNERS entries to publish; do not invent broker URLs or logos.
import { h, icon } from '../core/ui.js';

/**
 * Partner slots. Edit this array to add real affiliates later.
 * - name: display name
 * - description: short, neutral, factual blurb (no performance or return claims)
 * - category: grouping key matching CATEGORIES
 * - logoText / logoUrl: optional monogram or image URL (null = placeholder)
 * - affiliateUrl: exact referral href, or null / '' for TBD (CTA disabled)
 * - status: 'live' to publish; anything else stays hidden from the public page
 */
export const PARTNERS = [
  {
    id: 'robinhood',
    name: 'Robinhood',
    category: 'brokers',
    description: 'Commission-free investing app for US stocks, ETFs, options and crypto. '
      + 'In the US, brokerage accounts are held with Robinhood Financial LLC, a FINRA member. '
      + 'Products and availability differ by country.',
    logoText: null,
    logoUrl: 'assets/affiliates/robinhood.svg',
    affiliateUrl: 'https://join.robinhood.com/rehnes',
    status: 'live',
  },
  {
    id: 'public',
    name: 'Public',
    category: 'brokers',
    description: 'US investing platform (Public.com) for stocks, ETFs, options, bonds and crypto. '
      + 'Brokerage services are provided by a FINRA-member broker-dealer; accounts are mainly for US residents.',
    logoText: null,
    logoUrl: 'assets/affiliates/public.svg',
    affiliateUrl: 'https://public.com/user-referral?referrer=Rehne82057',
    status: 'live',
  },
  {
    id: 'webull',
    name: 'Webull',
    category: 'brokers',
    description: 'Trading app for stocks, ETFs and options with charting tools and a paper-trading mode. '
      + 'In the US, accounts are held with Webull Financial LLC, a FINRA member; other regions use separately regulated entities.',
    logoText: null,
    logoUrl: 'assets/affiliates/webull.svg',
    affiliateUrl: 'https://www.webull.com/s/3Kh5mWpood8i1GGOz9',
    status: 'live',
  },
  {
    id: 'upcomers',
    name: 'Upcomers',
    category: 'funded',
    description: 'Funded-account (prop trading) platform. Programs like this usually charge a fee for an evaluation '
      + 'with strict trading rules — read the rules, fees and payout terms in full before paying.',
    logoText: null,
    logoUrl: 'assets/affiliates/upcomers.svg',
    affiliateUrl: 'https://app.upcomers.com/en/checkout?ref=gy4xupgr',
    status: 'live',
  },
];

/** Section headings for live partners (order = display order). */
export const CATEGORIES = [
  { id: 'brokers', title: 'Brokers & apps', blurb: 'Brokerages and investing apps with referral links.' },
  { id: 'funded', title: 'Funded accounts', blurb: 'Prop / funded-account platforms.' },
];

function logoSlot(p) {
  const base = 'aff-row__logo';
  if (p.logoUrl) {
    return h('div', { class: `${base} ${base}--img`, 'aria-hidden': 'true' },
      h('img', {
        class: 'aff-row__logo-img',
        src: p.logoUrl,
        alt: '',
        width: 48,
        height: 48,
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
  }, icon('layers', { size: 20 }));
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

/** Affiliate + risk disclosure, shown at the top of the page before any partner link. */
function disclosure() {
  return h('div', {
    class: 'callout callout--warn aff-disclaimer',
    role: 'note',
    'aria-labelledby': 'aff-disclosure-h',
  },
  icon('info', { size: 18 }),
  h('div', null,
    h('p', { id: 'aff-disclosure-h' }, h('strong', null, 'Affiliate disclosure — please read before clicking.')),
    h('ul', { class: 'aff-disclaimer__list' },
      h('li', null, 'The links below are affiliate / referral links. If you sign up or pay through them, '
        + 'The Trade School may earn a commission or other reward, at no extra cost to you.'),
      h('li', null, 'A listing here is not a recommendation or endorsement, and nothing on this page is financial advice. '
        + 'We have not assessed whether any provider is suitable for you.'),
      h('li', null, 'Trading and investing involve risk of loss, including losing more than you expect. '
        + 'Only use money you can afford to lose.'),
      h('li', null, 'Products, fees and availability vary by country, and some providers do not accept residents of every country.'),
      h('li', null, 'Check that a provider is authorised or regulated where you live (e.g. with your national securities regulator) '
        + 'and read its terms, fees and risk disclosures before opening an account.'))));
}

export default {
  id: 'platforms',
  mount(root) {
    // Only published partners render; placeholder / unfinished slots stay out of public view.
    const live = PARTNERS.filter((p) => p.status === 'live');

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
          'Trading platforms and tools we have referral partnerships with. '
          + 'Read the disclosure below first — these are commercial links, not recommendations.')),
      disclosure(),
      h('section', {
        class: 'aff-partners',
        'aria-labelledby': 'aff-trading-platforms',
      },
        h('header', { class: 'aff-section__head' },
          h('h2', { class: 'aff-section__title', id: 'aff-trading-platforms' }, 'Trading platforms')),
        ...sections),
      h('p', { class: 'faint aff-footnote' },
        'Descriptions are short factual summaries and may be out of date — the provider’s own site and legal documents are authoritative. ',
        'See also our ', h('a', { href: '#terms' }, 'Terms of Service'), ' and ', h('a', { href: '#privacy' }, 'Privacy Policy'), '.')));
  },
};
