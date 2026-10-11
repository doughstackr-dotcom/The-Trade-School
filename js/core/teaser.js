// In-page teaser chrome for Library / Playbook / Glossary (and similar).
// Pages stay routable for everyone; full use requires hasPaidAccess().
import { h, icon } from './ui.js';
import * as access from './access.js';
import { PLANS } from '../config.js';

/**
 * Banner + optional lock shell when the visitor lacks a paid plan.
 * Returns { locked, banner, wrap(children) } for the page to compose.
 */
export function toolsTeaser(pageLabel = 'This section') {
  const locked = access.isEnforcing() && !access.hasPaidAccess();
  if (!locked) {
    return {
      locked: false,
      banner: null,
      wrap: (node) => node,
    };
  }

  const a = access.getAccess();
  const signedIn = !!a.user;
  const price = PLANS.beginner?.price ?? 19.99;

  const banner = h('section', {
    class: 'teaser-banner card card--raised',
    role: 'region',
    'aria-label': `${pageLabel} preview — subscribe to unlock`,
  },
    h('div', { class: 'teaser-banner__copy' },
      h('p', { class: 'eyebrow' }, 'Preview'),
      h('h2', { class: 'teaser-banner__title' }, `${pageLabel} is a members preview`),
      h('p', { class: 'muted' },
        signedIn
          ? `You can browse the teaser below. Subscribe to the Beginner plan ($${price}/mo) or Advanced to open the full content.`
          : `Anyone can see this teaser. Sign in and subscribe (Beginner $${price}/mo or Advanced) to open the full content.`)),
    h('div', { class: 'teaser-banner__actions row' },
      signedIn
        ? h('a', { class: 'btn btn--primary', href: '#paywall' }, icon('lock', { size: 16 }), 'View plans')
        : h('a', { class: 'btn btn--primary', href: '#account.signup' }, icon('lock', { size: 16 }), 'Sign in to subscribe'),
      h('a', { class: 'btn btn--ghost', href: '#dashboard' }, 'Dashboard'),
      h('a', { class: 'btn btn--ghost', href: '#platforms' }, 'Platforms (free)'),
    ),
  );

  function wrap(node) {
    return h('div', { class: 'teaser-lock' },
      h('div', {
        class: 'teaser-lock__body',
        inert: true,
        'aria-hidden': 'true',
      }, node),
      h('div', { class: 'teaser-lock__veil' },
        h('div', { class: 'teaser-lock__panel card' },
          h('span', { class: 'teaser-lock__icon', 'aria-hidden': 'true' }, icon('lock', { size: 28 })),
          h('p', null, h('strong', null, 'Full access is locked')),
          h('p', { class: 'muted' }, 'Subscribe to explore every card and detail view.'),
          h('a', { class: 'btn btn--primary', href: signedIn ? '#paywall' : '#account.signup' },
            signedIn ? 'Unlock with a plan' : 'Sign in to unlock'),
        ),
      ),
    );
  }

  return { locked: true, banner, wrap };
}

export default { toolsTeaser };
