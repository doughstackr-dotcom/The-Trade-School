// Paywall: shown by the router when setAccessGate blocks a lesson/game.
// Explains Beginner vs Advanced plans; degrades gracefully when billing secrets are missing.
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
        on: {
          click: () => onSubscribe?.(planId),
        },
      }, lockedAdvanced ? 'Upgrade to Advanced' : `Get ${p.name}`),
  );
}

export default {
  mount(root, ctx) {
    const entry = ctx.entry;
    const need = access.requiredPlan(entry);
    const planName = PLANS[need]?.name || 'Paid';
    const title = entry?.title || 'This module';
    const back = entry?.tier === 'advanced' ? 'advanced' : entry?.tier === 'beginner' ? 'beginner' : 'home';

    const status = h('p', { class: 'muted paywall__status', 'aria-live': 'polite' }, '');
    const freeList = FREE_IDS.map((id) => {
      const e = ctx.registry?.findEntry?.(id);
      return e ? h('li', null, h('a', { href: `#${e.type === 'game' ? 'g' : 'l'}.${e.id}` }, e.title)) : null;
    }).filter(Boolean);

    async function refreshStatus() {
      await access.ready;
      const a = access.getAccess();
      if (!a.user) {
        status.textContent = 'Sign in to subscribe, or keep learning on the free unit.';
      } else if (a.level === 'advanced') {
        status.textContent = 'You already have Advanced access. If this page is stuck, refresh.';
      } else if (a.level === 'beginner') {
        status.textContent = need === 'advanced'
          ? 'Your Beginner plan is active. Upgrade to Advanced to open this module.'
          : 'Your Beginner plan should unlock this — try refreshing.';
      } else {
        status.textContent = 'Signed in on the free tier. Choose a plan below to unlock.';
      }
    }

    async function onSubscribe(planId) {
      await access.ready;
      const a = access.getAccess();
      if (!a.user) {
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
        ctx.navigate(ctx.route?.key || 'home');
      }
    }

    root.append(
      h('div', { class: 'container paywall' },
        h('section', { class: 'paywall__hero card card--raised', 'aria-labelledby': 'paywall-h' },
          h('p', { class: 'eyebrow' }, 'Members only'),
          h('h1', { id: 'paywall-h' }, title, ' is on the ', planName, ' plan'),
          h('p', { class: 'lead' },
            'The Trade School keeps a free unit open so you can try the teaching style. Full Beginner and Advanced tracks are monthly subscriptions.'),
          status,
          h('div', { class: 'row paywall__actions' },
            h('a', { class: 'btn btn--primary', href: '#account' }, icon('lock', { size: 16 }), 'Account / sign in'),
            h('a', { class: 'btn btn--ghost', href: `#${back}` }, icon('arrow-left', { size: 16 }),
              back === 'home' ? 'Back home' : `Back to ${back === 'advanced' ? 'Advanced' : 'Beginner'}`),
            h('a', { class: 'btn btn--ghost', href: '#dashboard' }, 'Dashboard'),
          ),
        ),
        h('section', { class: 'paywall__plans', 'aria-label': 'Subscription plans' },
          planCard('beginner', { current: null, onSubscribe }),
          planCard('advanced', { highlight: true, current: null, onSubscribe }),
        ),
        h('section', { class: 'card paywall__free' },
          h('h2', null, 'Free while you decide'),
          h('p', { class: 'muted' }, 'No card required for these:'),
          h('ul', { class: 'lesson-list' }, freeList.length ? freeList : h('li', null, 'Candle anatomy, Candle Builder, Daily Challenge, Markets & Orders, Order Desk')),
          h('p', { class: 'faint' }, 'Educational simulations only — not financial advice. Cancel anytime in the billing portal.'),
        ),
      ),
    );

    let unsub = null;
    refreshStatus().then(() => {
      unsub = access.onChange(() => refreshStatus());
    });
    // Fill current plan highlight after ready
    access.ready.then(() => {
      const a = access.getAccess();
      const plans = root.querySelector('.paywall__plans');
      if (!plans) return;
      plans.replaceChildren(
        planCard('beginner', { current: a.level, onSubscribe }),
        planCard('advanced', { highlight: true, current: a.level, onSubscribe }),
      );
    });

    return () => { if (unsub) unsub(); };
  },
};
