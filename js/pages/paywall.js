// Paywall: shown by the router when setAccessGate blocks a lesson/game/course page.
// Unsigned visitors are steered to sign-up/login; signed-in free users see plan cards.
import { h, icon, toast } from '../core/ui.js';
import { PLANS, FREE_IDS } from '../config.js';
import * as access from '../core/access.js';

function planCard(planId, { highlight = false, current = null, onSubscribe } = {}) {
  const p = PLANS[planId];
  if (!p) return null;
  const isCurrent = current === planId || (current === 'advanced' && planId === 'beginner');
  const lockedAdvanced = planId === 'advanced' && current === 'beginner';
  return h('article', {
    class: ['plan-card', 'card', highlight && 'plan-card--highlight', isCurrent && 'plan-card--current'],
    'aria-label': `${p.name} plan, $${p.price} per month`,
  },
    highlight ? h('p', { class: 'eyebrow' }, 'Most popular') : h('p', { class: 'eyebrow' }, 'Plan'),
    h('h3', { class: 'plan-card__title' }, p.name),
    h('p', { class: 'plan-card__price' },
      h('span', { class: 'mono' }, `$${p.price}`),
      h('span', { class: 'faint' }, ' / month')),
    h('ul', { class: 'plan-card__perks' },
      planId === 'beginner'
        ? [
          h('li', null, icon('check', { size: 14 }), ' Every Beginner lesson and game'),
          h('li', null, icon('check', { size: 14 }), ' Practice, Arcade and Survival styles'),
          h('li', null, icon('check', { size: 14 }), ' Textbook and real-market charts'),
          h('li', null, icon('check', { size: 14 }), ' What Happens Next? (Beginner mode)'),
        ]
        : [
          h('li', null, icon('check', { size: 14 }), ' Everything in Beginner'),
          h('li', null, icon('check', { size: 14 }), ' Every Advanced lesson and game'),
          h('li', null, icon('check', { size: 14 }), ' Trade Simulator, Fib Sniper, Trap or Trade'),
          h('li', null, icon('check', { size: 14 }), ' Live Predict and capstone drills'),
        ]),
    isCurrent && current === planId
      ? h('p', { class: 'chip chip--bull' }, 'Your plan')
      : h('button', {
        type: 'button',
        class: ['btn', highlight ? 'btn--primary' : 'btn--ghost', 'btn--block'],
        'aria-label': `Subscribe to ${p.name}`,
        on: { click: () => onSubscribe?.(planId) },
      }, lockedAdvanced ? 'Upgrade to Advanced' : `Get ${p.name}`),
    isCurrent && current === planId ? null : h('p', { class: 'consent-note' },
      'By continuing you agree to the ', h('a', { href: '#terms' }, 'Terms'), ', ',
      h('a', { href: '#privacy' }, 'Privacy Policy'), ' and ', h('a', { href: '#refunds' }, 'Refund Policy'),
      '. Renews monthly; cancel anytime.'),
  );
}

export default {
  mount(root, ctx) {
    const entry = ctx.entry;
    const need = access.requiredPlan(entry);
    const planName = PLANS[need]?.name || 'Paid';
    const title = entry?.title || 'This page';
    const back = entry?.tier === 'advanced' || entry?.tier === 'beginner' || entry?.tier === 'both'
      ? 'dashboard'
      : 'home';
    const routeKey = ctx.route?.key || '';
    // Signed-out visitors heading to #account come back here after signing in.
    const rememberHere = () => access.rememberReturn(routeKey);
    const toAccount = { click: rememberHere };

    const status = h('p', { class: 'muted paywall__status', 'aria-live': 'polite' }, '');
    const plansHost = h('section', { class: 'paywall__plans', 'aria-label': 'Subscription plans' });
    const freeList = FREE_IDS.map((id) => {
      const e = ctx.registry?.findEntry?.(id);
      return e ? h('li', null, h('a', { href: `#${e.type === 'game' ? 'g' : 'l'}.${e.id}` }, e.title)) : null;
    }).filter(Boolean);

    async function onSubscribe(planId) {
      await access.ready;
      const a = access.getAccess();
      if (!a.user) {
        rememberHere();
        ctx.navigate('account');
        toast('Sign in (or create an account) to subscribe.', { type: 'info' });
        return;
      }
      status.textContent = 'Opening checkout…';
      const res = await access.checkout(planId);
      if (!res.ok) {
        status.textContent = res.error || 'Subscriptions not open yet';
        toast(res.error || 'Subscriptions not open yet', { type: 'warn', duration: 5000 });
        return;
      }
      if (res.switched) {
        status.textContent = 'Plan updated. Reloading…';
        ctx.navigate(routeKey || 'home');
      }
    }

    function paint(a) {
      const signedIn = !!a.user;
      if (!signedIn) {
        status.textContent = 'Create a free account or sign in to open lessons, games and the rest of the school.';
        plansHost.replaceChildren(
          h('div', { class: 'card paywall__signin' },
            h('h2', null, 'Sign in to continue'),
            h('p', { class: 'muted' },
              title !== 'This page'
                ? `${title} is part of the course. Accounts are free — paid plans unlock the full tracks later.`
                : 'Course pages need a signed-in account. Sign-up takes about a minute.'),
            h('div', { class: 'row' },
              h('a', { class: 'btn btn--primary', href: '#account', on: toAccount }, icon('lock', { size: 16 }), 'Sign in / create account'),
              h('a', { class: 'btn btn--ghost', href: '#home' }, 'Back to home')),
          ),
        );
      } else {
        if (a.level === 'advanced') {
          status.textContent = 'You already have Advanced access. If this page is stuck, refresh.';
        } else if (a.level === 'beginner') {
          status.textContent = need === 'advanced'
            ? 'Your Beginner plan is active. Upgrade to Advanced to open this module.'
            : 'Your Beginner plan should unlock this — try refreshing.';
        } else {
          status.textContent = 'Signed in on the free tier. Free unit modules stay open; choose a plan for the full tracks.';
        }
        plansHost.replaceChildren(
          planCard('beginner', { current: a.level, onSubscribe }),
          planCard('advanced', { highlight: true, current: a.level, onSubscribe }),
        );
      }
    }

    root.append(
      h('div', { class: 'container paywall' },
        h('section', { class: 'paywall__hero card card--raised', 'aria-labelledby': 'paywall-h' },
          h('p', { class: 'eyebrow' }, 'Members only'),
          h('h1', { id: 'paywall-h' },
            entry ? [title, ' needs a ', planName === 'Paid' ? 'member account' : `${planName} plan`] : 'Sign in to open course content'),
          h('p', { class: 'lead' },
            'The Trade School keeps the landing page public. Lessons, games, tracks and labs need a free account — subscriptions unlock the full Beginner and Advanced tracks.'),
          status,
          h('div', { class: 'row paywall__actions' },
            h('a', { class: 'btn btn--primary', href: '#account', on: toAccount }, icon('lock', { size: 16 }), 'Account / sign in'),
            h('a', { class: 'btn btn--ghost', href: `#${back}` }, icon('arrow-left', { size: 16 }),
              back === 'home' ? 'Back home' : 'Back to Dashboard'),
          ),
        ),
        plansHost,
        h('section', { class: 'card paywall__free' },
          h('h2', null, 'Free after you sign in'),
          h('p', { class: 'muted' }, 'No card required for these modules once you have an account:'),
          h('ul', { class: 'lesson-list' }, freeList.length ? freeList : h('li', null, 'Candle anatomy, Candle Builder, Daily Challenge, Markets & Orders, Order Desk')),
          h('p', { class: 'faint' }, 'Educational simulations only — not financial advice. Cancel anytime in the billing portal.'),
        ),
      ),
    );

    let unsub = null;
    access.ready.then(() => {
      paint(access.getAccess());
      unsub = access.onChange(() => paint(access.getAccess()));
    });
    return () => { if (unsub) unsub(); };
  },
};
