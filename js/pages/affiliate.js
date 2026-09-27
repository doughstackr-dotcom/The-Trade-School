// Affiliate partners — trading platforms / tools with referral links.
// Fill PARTNERS entries to publish; do not invent broker URLs or logos.
import { h, icon } from '../core/ui.js';

/**
 * Partner slots. Edit this array to add real affiliates later.
 * - name: display name
 * - description: short blurb (owner-editable)
 * - logoText / logoUrl: optional monogram or image URL (null = placeholder)
 * - affiliateUrl: exact referral href, or null / '' for TBD (CTA disabled)
 * - status: 'live' | 'coming' — coming slots show “Coming soon / Partner TBD”
 */
export const PARTNERS = [
  {
    id: 'pocket-option',
    name: 'Pocket Option',
    description: 'Affiliate partner — short description coming soon. Replace this copy with an accurate product blurb.',
    logoText: 'PO',
    logoUrl: null,
    affiliateUrl: 'https://pocket-friends.co/r/zs9a40s5v6',
    status: 'live',
  },
  {
    id: 'robinhood',
    name: 'Robinhood',
    description: 'Affiliate partner — replace this placeholder with an accurate product blurb.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: 'https://join.robinhood.com/rehnes',
    status: 'live',
  },
  {
    id: 'public',
    name: 'Public',
    description: 'Affiliate partner — replace this placeholder with an accurate product blurb.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: 'https://public.com/user-referral?referrer=Rehne82057',
    status: 'live',
  },
  {
    id: 'partner-tbd-2',
    name: 'Partner TBD',
    description: 'Coming soon — another trading platform or tool partnership will land here.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: null,
    status: 'coming',
  },
  {
    id: 'partner-tbd-3',
    name: 'Partner TBD',
    description: 'Coming soon — placeholder slot for a future affiliate link.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: null,
    status: 'coming',
  },
  {
    id: 'partner-tbd-4',
    name: 'Partner TBD',
    description: 'Coming soon — placeholder slot for a future affiliate link.',
    logoText: null,
    logoUrl: null,
    affiliateUrl: null,
    status: 'coming',
  },
];

function logoSlot(p) {
  if (p.logoUrl) {
    return h('div', { class: 'aff-card__logo' },
      h('img', {
        class: 'aff-card__logo-img',
        src: p.logoUrl,
        alt: `${p.name} logo`,
        width: 56,
        height: 56,
        loading: 'lazy',
        decoding: 'async',
      }));
  }
  if (p.logoText) {
    return h('div', {
      class: 'aff-card__logo aff-card__logo--mono',
      'aria-hidden': 'true',
    }, p.logoText);
  }
  return h('div', {
    class: 'aff-card__logo aff-card__logo--empty',
    'aria-hidden': 'true',
  }, icon('layers', { size: 22 }));
}

function cta(p) {
  const url = typeof p.affiliateUrl === 'string' ? p.affiliateUrl.trim() : '';
  if (url && url !== '#') {
    return h('a', {
      class: 'btn btn--primary aff-card__cta',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer sponsored',
      'data-no-route': '',
    }, 'Visit partner', icon('arrow-right', { size: 14 }));
  }
  return h('button', {
    type: 'button',
    class: 'btn aff-card__cta',
    disabled: true,
    title: 'Affiliate link not added yet',
  }, 'Add link');
}

function partnerCard(p) {
  const coming = p.status !== 'live';
  return h('article', {
    class: ['aff-card', 'card', coming && 'aff-card--coming'],
    id: `aff-${p.id}`,
  },
  h('div', { class: 'aff-card__top' },
    logoSlot(p),
    h('div', { class: 'aff-card__titles' },
      h('h2', { class: 'aff-card__name' }, p.name),
      coming
        ? h('span', { class: 'chip chip--sm chip--outline' }, 'Coming soon')
        : h('span', { class: 'chip chip--sm chip--accent' }, 'Partner'))),
  h('p', { class: 'aff-card__desc' }, p.description),
  h('div', { class: 'aff-card__foot' }, cta(p),
    coming ? h('p', { class: 'faint aff-card__note' }, 'Partner TBD — fill name, blurb, and affiliate URL in PARTNERS.') : null));
}

export default {
  id: 'affiliate',
  mount(root) {
    root.append(h('div', { class: 'container affiliate' },
      h('aside', {
        class: 'aff-risk',
        role: 'alert',
        'aria-label': 'Risk and educational disclaimer',
      },
        h('p', { class: 'aff-risk__text' },
          'This is not financial advice. The Trade School is educational material only. '
          + 'Trade at your own risk.')),
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Partners'),
        h('h1', null, 'Affiliate'),
        h('p', { class: 'lead' },
          'Platforms and tools we partner with. Some links below are affiliate / referral links — '
          + 'if you sign up through them, The Trade School may earn a commission at no extra cost to you.')),
      h('div', { class: 'callout callout--warn aff-disclaimer', role: 'note' },
        icon('info', { size: 18 }),
        h('div', null,
          h('p', null, h('strong', null, 'Affiliate disclosure.')),
          h('p', { class: 'muted' },
            'These are educational partnerships, not endorsements. Always do your own research, '
            + 'read each platform’s terms, and never risk money you cannot afford to lose.'))),
      h('section', {
        class: 'aff-grid',
        'aria-label': 'Affiliate partners',
      }, PARTNERS.map(partnerCard))));
  },
};
