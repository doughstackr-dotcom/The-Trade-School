// #pricing (#pricing.<plan> highlights a plan): the free tier and the two monthly plans, with
// exact lists of what each unlocks (generated from the registry), the member's current plan,
// an FAQ and the secure-payment note. Also exports planCards() for the paywall.
import { h, icon } from '../core/ui.js';
import { navigate } from '../core/router.js';
import { auth } from '../core/auth.js';
import { PLANS } from '../config.js';
import { unlocksFor, planCta, rankOf, PLAN_LABELS } from '../core/access.js';
import { hashFor } from '../registry.js';

const PRICE = (plan) => `$${PLANS[plan].price.toFixed(2)}`;

const TIER_COPY = {
  account: { name: 'Free', tagline: 'Try the method, no card needed.', price: '$0', per: 'forever' },
  beginner: { name: PLANS.beginner.name, tagline: 'Every Beginner lesson and game: read the chart.', price: PRICE('beginner'), per: 'per month' },
  advanced: { name: PLANS.advanced.name, tagline: 'Everything in Beginner, plus planning the trade.', price: PRICE('advanced'), per: 'per month' },
};

/** A feature line with an optional expandable list of lessons / games (links). */
function featureList(plan) {
  const u = unlocksFor(plan);
  const items = [];
  const group = (label, entries) => {
    if (!entries.length) return;
    items.push(h('li', { class: 'plan-feat' },
      icon('check', { size: 16 }),
      h('details', { class: 'plan-feat__more' },
        h('summary', null, h('span', null, label), icon('chevron-down', { size: 14 })),
        h('ul', { class: 'plan-feat__list' }, entries.map((e) => h('li', null, h('a', { href: `#${hashFor(e.id)}` }, e.title)))))));
  };
  const n = (x, word) => `${x} ${word}${x === 1 ? '' : 's'}`;
  if (plan === 'account') {
    group([u.lessons.length && n(u.lessons.length, 'lesson'), u.games.length && n(u.games.length, 'game')].filter(Boolean).join(' and '), [...u.lessons, ...u.games]);
  } else {
    const tier = plan === 'beginner' ? 'Beginner' : 'Advanced';
    group(`${n(u.lessons.length, `${tier} lesson`)}`, u.lessons);
    group(`${n(u.games.length, `${tier} game`)}`, u.games);
  }
  if (u.modes.length) {
    const titles = u.modes.map((m) => m.game.title);
    const list = titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}` : titles[0];
    items.push(h('li', { class: 'plan-feat' }, icon('check', { size: 16 }), h('span', null, `${u.modes[0].mode === 'advanced' ? 'Advanced' : 'Beginner'} modes in ${list}`)));
  }
  for (const p of u.pages) items.push(h('li', { class: 'plan-feat' }, icon('check', { size: 16 }), h('span', null, p.title)));
  for (const x of u.extras) items.push(h('li', { class: 'plan-feat' }, icon('check', { size: 16 }), h('span', null, x)));
  return h('ul', { class: 'plan-feats' }, items);
}

/**
 * Plan cards with working buttons. opts: { plans = ['account', 'beginner', 'advanced'],
 * highlight: 'beginner' | 'advanced' | null, why: text for the highlighted card ('Unlocks …'),
 * returnTo: route to come back to after signing up (default: this pricing page) }.
 * → { el, destroy() }
 */
export function planCards({ plans = ['account', 'beginner', 'advanced'], highlight = null, why = null, returnTo = null } = {}) {
  const grid = h('div', { class: 'plan-grid', 'data-count': String(plans.length) });
  const msg = h('div', { class: 'plan-msg', role: 'alert' });
  const busyNote = h('p', { class: 'plan-busy', role: 'status', hidden: true });
  let pending = null;   // plan whose button is working

  function say(text, tone = 'bad', extra = null) {
    msg.replaceChildren();
    if (!text) return;
    msg.append(h('div', { class: `callout callout--${tone === 'good' ? 'tip' : 'warn'} plan-msg__box` },
      icon(tone === 'good' ? 'check' : 'info', { size: 18 }), h('div', null, h('p', null, text), extra)));
  }

  async function act(plan, cta) {
    if (cta.action === 'signup') {
      auth.setReturnTo(returnTo || `pricing.${plan}`);
      navigate('signup');
      return;
    }
    if (cta.action === 'included' || pending) return;
    pending = plan;
    say(null);
    render();
    try {
      if (cta.action === 'manage') {
        await auth.openBillingPortal();
      } else {
        const res = await auth.checkout(plan);
        if (res?.switched) say(`Switching you to the ${PLANS[res.plan].name} plan. This takes a few seconds; the difference for this month is prorated.`, 'good');
      }
    } catch (err) {
      if (err?.code === 'signin') {
        say('Please sign in again to continue.', 'bad', h('a', { class: 'btn btn--sm', href: '#signin' }, 'Sign in'));
      } else if (err?.code === 'no-billing') {
        say(err.message);
      } else {
        say(err?.message || 'Something went wrong. Please try again.');
      }
    } finally {
      pending = null;
      render();
    }
  }

  function card(plan) {
    const copy = TIER_COPY[plan];
    const lv = auth.level;
    const current = plan === 'account' ? lv === 'free' : lv === plan;
    const hi = highlight === plan;
    let action = null;
    if (plan === 'account') {
      action = !lv
        ? h('a', { class: 'btn btn--block', href: '#signup', 'data-plan-cta': 'account', on: { click: () => auth.setReturnTo(returnTo || '') } }, 'Create free account')
        : h('span', { class: 'btn btn--block btn--static', 'aria-disabled': 'true' }, current ? 'Your current plan' : 'Included in your plan');
    } else {
      const cta = planCta(plan, lv);
      const offline = auth.mode === 'offline';
      const busy = auth.billingBusy || !!pending;
      const disabled = cta.action === 'included' || (cta.action !== 'signup' && (busy || offline));
      const label = pending === plan ? (cta.action === 'manage' ? 'Opening billing…' : 'Opening secure checkout…') : cta.label;
      action = h('button', {
        type: 'button',
        class: ['btn', 'btn--block', (cta.action === 'subscribe' || cta.action === 'upgrade' || cta.action === 'signup') && (hi || !highlight) && 'btn--primary'],
        'data-plan-cta': plan,
        'data-action': cta.action,
        disabled,
        'aria-busy': pending === plan ? 'true' : null,
        on: { click: () => act(plan, cta) },
      }, label, cta.action === 'upgrade' || cta.action === 'subscribe' ? icon('arrow-right', { size: 16 }) : null);
    }
    return h('article', {
      class: ['plan-card', `plan-card--${plan}`, hi && 'is-highlight', current && 'is-current'],
      'data-plan': plan,
      'aria-labelledby': `plan-${plan}-name`,
    },
    hi && why ? h('p', { class: 'plan-card__why' }, icon('lock', { size: 14 }), h('span', null, why)) : null,
    h('header', { class: 'plan-card__head' },
      h('div', { class: 'row row--between plan-card__top' },
        h('h3', { class: 'plan-card__name', id: `plan-${plan}-name` }, copy.name),
        current ? h('span', { class: 'chip chip--bull chip--sm' }, icon('check', { size: 12 }), 'Current plan')
          : plan === 'advanced' ? h('span', { class: 'chip chip--accent chip--sm' }, 'Includes Beginner') : null),
      h('p', { class: 'plan-card__price' }, h('span', { class: 'plan-card__amount mono' }, copy.price), h('span', { class: 'plan-card__per' }, copy.per)),
      h('p', { class: 'plan-card__tagline muted' }, copy.tagline)),
    action,
    plan === 'advanced' ? h('p', { class: 'plan-card__plus eyebrow' }, 'Everything in Beginner, plus') : null,
    plan === 'beginner' ? h('p', { class: 'plan-card__plus eyebrow' }, 'Everything in Free, plus') : null,
    featureList(plan));
  }

  function render() {
    grid.replaceChildren(...plans.map(card));
    const busy = auth.billingBusy;
    busyNote.hidden = !busy;
    busyNote.replaceChildren(...(busy ? [icon('clock', { size: 16 }), h('span', null, auth.unlock?.source === 'switch'
      ? 'Switching your plan… the buttons are paused for a few seconds.'
      : 'Finishing your payment… the plan buttons are paused until it is confirmed.')] : []));
  }

  const offChange = auth.on('change', render);
  const offUnlocked = auth.on('unlocked', ({ level }) => {
    say(`You're on the ${PLAN_LABELS[level] || 'new plan'} now. Enjoy!`, 'good');
  });
  render();
  return {
    el: h('div', { class: 'plans' }, busyNote, grid, msg),
    destroy() {
      offChange();
      offUnlocked();
    },
  };
}

function faq() {
  const items = [
    ['Can I cancel anytime?', 'Yes. Open your Account page and choose Manage billing, then cancel. You keep your plan until the end of the month you have paid for, and you are not charged again.'],
    ['What happens when I switch plans?', 'Upgrading from Beginner to Advanced unlocks the Advanced track straight away. Plan switches are prorated: you pay only the difference for the rest of the current billing month. You can move back to Beginner from Manage billing.'],
    ['What currency are the prices in?', `US dollars (USD). Beginner is ${PRICE('beginner')} and Advanced is ${PRICE('advanced')}, billed monthly.`],
    ['What do I get for free?', 'A free account opens the first unit (candlestick anatomy and the Candle Builder game), the Daily Challenge, the Pattern Library, the Setup Playbook index, and keeps your progress in sync across your devices. No card needed.'],
    ['Is this financial advice?', 'No. The Trade School is educational content only. Lessons and games teach how traders read charts; nothing here is a recommendation to buy or sell anything, and real-market charts show past data, never a prediction.'],
    ['How are payments handled?', 'Payments are processed by Stripe. Your card details go straight to Stripe and never touch our servers; we only store whether your subscription is active.'],
  ];
  return h('section', { class: 'pricing-faq', 'aria-labelledby': 'faq-h' },
    h('h2', { id: 'faq-h', class: 'pricing-faq__title' }, 'Questions'),
    h('div', { class: 'pricing-faq__list' },
      items.map(([q, a]) => h('details', { class: 'faq' },
        h('summary', null, h('span', null, q), icon('chevron-down', { size: 16 })),
        h('p', { class: 'muted' }, a)))));
}

export default {
  id: 'pricing',
  async mount(root, ctx) {
    const param = ctx.param === 'beginner' || ctx.param === 'advanced' ? ctx.param : null;
    const cancelled = auth.consumeCheckoutReturn('cancel');
    const banner = h('div', { class: 'pricing__banners' });
    if (cancelled) {
      banner.append(h('div', { class: 'callout pricing__banner', role: 'status' },
        icon('info', { size: 18 }),
        h('p', null, h('strong', null, 'Checkout cancelled'), ' — no charge was made. You can pick a plan whenever you are ready.')));
    }
    const status = h('p', { class: 'pricing__status muted' });
    const renderStatus = () => {
      const lv = auth.level;
      status.replaceChildren();
      if (auth.mode === 'offline') {
        status.append(icon('info', { size: 16 }), ' Accounts are unavailable right now, so plans cannot be bought. The free lessons still work.');
      } else if (lv) {
        status.append(`Signed in as `, h('strong', null, auth.displayName), ` · ${lv === 'free' ? 'Free plan' : PLAN_LABELS[lv]}`);
        if (rankOf(lv) >= rankOf('beginner')) status.append(' · ', h('a', { href: '#account' }, 'Manage billing'));
      } else {
        status.append('Create a free account first; you can subscribe from any locked lesson or right here.');
      }
    };
    const cards = planCards({ highlight: param });
    const offStatus = auth.on('change', renderStatus);
    renderStatus();

    root.append(h('div', { class: 'pricing container' },
      banner,
      h('header', { class: 'pricing__hero' },
        h('p', { class: 'eyebrow eyebrow--accent' }, 'Plans & pricing'),
        h('h1', { class: 'pricing__title' }, 'Learn free. Upgrade when you are ready.'),
        h('p', { class: 'lead pricing__lead' }, 'Start with a free account and the first unit. Beginner opens the whole Read the chart track; Advanced adds Plan the trade. Cancel anytime.'),
        status),
      cards.el,
      h('div', { class: 'secure-note' },
        h('span', { class: 'secure-note__icon', 'aria-hidden': 'true' }, icon('shield', { size: 22 })),
        h('p', null, h('strong', null, 'Secure payments by Stripe.'), ' Your card details go straight to Stripe and never touch our servers. Prices in USD, billed monthly; cancel anytime from Manage billing.')),
      faq(),
      h('p', { class: 'pricing__legal faint t-14' },
        'Educational content only, not financial advice. By subscribing you agree to the ', h('a', { href: '#terms' }, 'Terms'), ' and ', h('a', { href: '#privacy' }, 'Privacy policy'), '.')));

    if (param) {
      requestAnimationFrame(() => {
        const el = root.querySelector(`.plan-card[data-plan="${param}"]`);
        if (el && window.innerWidth < 900) el.scrollIntoView({ block: 'start', behavior: 'instant' });
      });
    }
    return () => {
      cards.destroy();
      offStatus();
    };
  },
};
