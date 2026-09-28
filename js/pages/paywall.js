// Paywall: mounted by the router in place of a lesson, game or page the member's plan does not
// include (ctx.entry = the requested lesson/game, ctx.route = its route, ctx.blocked = true).
// Signed out: a pitch for the item + "Create free account" / "Sign in" (and the plans for paid
// items). Signed in without the plan: the plan cards with the needed plan highlighted.
// The requested route is remembered so sign-in and checkout bring the member back to it.
import { h, icon, tierChip } from '../core/ui.js';
import { auth } from '../core/auth.js';
import { describeTarget, blockReason, lockLabel, PLAN_LABELS } from '../core/access.js';
import { findTier, unitOf, findEntry, hashFor } from '../registry.js';
import { planCards } from './pricing.js';
import { FREE_IDS } from '../config.js';

const KIND_LABEL = { quiz: 'Quiz', draw: 'Draw', predict: 'Predict', simulation: 'Simulation', calc: 'Calculate', memory: 'Memory', swipe: 'Swipe', story: 'Story', live: 'Live' };

function pitch(info, entry) {
  const tier = entry?.tier && entry.tier !== 'both' ? entry.tier : null;
  const unit = entry ? unitOf(entry.id, entry.tier === 'both' ? undefined : entry.tier) : null;
  const kind = info.kind === 'lesson' ? `Lesson · ${entry.minutes} min`
    : info.kind === 'game' ? `Game · ${KIND_LABEL[entry.kind] || 'Play'} · ${entry.minutes} min`
      : 'Tool';
  const facts = entry?.topics || entry?.skills || [];
  const siblings = unit ? [unit.lesson, ...unit.games].filter(Boolean).filter((id) => id !== entry.id).map(findEntry).filter(Boolean) : [];
  const need = lockLabel(info.required);
  return h('section', { class: 'paywall__pitch' },
    h('div', { class: 'row row--sm paywall__chips' },
      tier ? tierChip(tier) : entry?.tier === 'both' ? tierChip('both') : null,
      need ? h('span', { class: 'chip chip--outline lock-chip', 'data-lock': info.required }, icon('lock', { size: 12 }), need) : null),
    h('p', { class: 'eyebrow' }, [unit ? unit.title : null, kind].filter(Boolean).join(' · ')),
    h('h1', { class: 'paywall__title' }, info.title),
    info.blurb ? h('p', { class: 'lead paywall__blurb' }, info.blurb) : null,
    facts.length ? h('ul', { class: 'paywall__facts' }, facts.map((f) => h('li', null, icon('check', { size: 15 }), h('span', null, f)))) : null,
    siblings.length ? h('p', { class: 'faint t-14 paywall__unit' }, `Same unit: ${siblings.map((s) => s.title).join(' · ')}`) : null);
}

function backLink(entry) {
  const tier = entry?.tier === 'advanced' ? 'advanced' : entry?.tier === 'beginner' ? 'beginner' : null;
  const t = tier ? findTier(tier) : null;
  return h('a', { class: 'link-btn', href: t ? `#${t.id}` : '#home' }, icon('arrow-left', { size: 16 }), t ? `${t.title} track` : 'Home');
}

export default {
  id: 'paywall',
  mount(root, ctx) {
    const route = ctx.route || { kind: 'notfound' };
    const entry = route.kind === 'lesson' || route.kind === 'game' ? ctx.entry : null;
    const target = entry || route;
    const info = describeTarget(target) || { kind: 'page', title: 'This page', blurb: '', required: 'account' };
    if (route.key) auth.setReturnTo(route.key);

    const body = h('div', { class: 'paywall__body' });
    const wrap = h('div', { class: 'paywall container', 'data-paywall': info.required || 'account' },
      backLink(entry),
      body);
    root.append(wrap);

    let cards = null;
    let lastKey = null;
    function render() {
      const reason = blockReason(target, auth.level) || { required: info.required, plan: null, reason: 'open' };
      // Only rebuild when the reason changes (the plan cards follow busy / unlock states themselves).
      const key = `${reason.reason}|${reason.plan}|${auth.level}|${auth.mode === 'offline'}`;
      if (key === lastKey) return;
      lastKey = key;
      cards?.destroy();
      cards = null;
      const plan = reason.plan;
      const planName = plan ? PLAN_LABELS[plan] : null;
      body.replaceChildren();
      body.dataset.reason = reason.reason;

      const side = h('div', { class: 'paywall__cta card card--raised' });
      if (reason.reason === 'open') {
        side.append(h('p', null, 'Unlocked. Opening…'));
      } else if (reason.reason === 'signin') {
        side.append(
          h('p', { class: 'paywall__cta-title' }, plan ? `Part of the ${planName}` : 'Free with an account'),
          h('p', { class: 'muted' }, plan
            ? 'Create a free account first (it also saves your progress), then choose a plan. Already a member? Sign in.'
            : 'Create a free account to open it. No card needed, and your progress is saved to your account.'),
          h('div', { class: 'stack stack--sm' },
            h('a', { class: 'btn btn--primary btn--block', href: '#signup', 'data-action': 'signup' }, 'Create free account', icon('arrow-right', { size: 16 })),
            h('a', { class: 'btn btn--block', href: '#signin', 'data-action': 'signin' }, 'Sign in')));
      } else {
        side.append(
          h('p', { class: 'paywall__cta-title' }, reason.reason === 'upgrade' ? 'Upgrade to Advanced' : `Part of the ${planName}`),
          h('p', { class: 'muted' }, reason.reason === 'upgrade'
            ? `You are on the Beginner plan. Advanced adds the whole Plan the trade track; the switch is prorated.`
            : `You are signed in on the free plan. Subscribe to open this and everything else in the ${planName}.`),
          h('a', { class: 'link-btn', href: `#pricing.${plan}` }, 'Compare plans', icon('arrow-right', { size: 14 })));
      }

      body.append(h('div', { class: 'paywall__grid' }, pitch(info, entry), side));

      if (plan && reason.reason !== 'open') {
        cards = planCards({
          plans: ['beginner', 'advanced'],
          highlight: plan,
          why: `Unlocks ${info.title}`,
          returnTo: route.key,
        });
        body.append(h('section', { class: 'paywall__plans', 'aria-label': 'Plans' },
          h('h2', { class: 'paywall__plans-title' }, reason.reason === 'signin' ? 'Plans' : 'Choose your plan'),
          cards.el));
      }
      // Signed out on a paid item: point at the free taster (the first free lesson).
      const taster = FREE_IDS.map(findEntry).find((e) => e && e.type === 'lesson');
      if (plan && reason.reason === 'signin' && taster && taster.id !== entry?.id) {
        body.append(h('p', { class: 'paywall__try faint' }, 'Want to try first? ',
          h('a', { href: `#${hashFor(taster.id)}` }, taster.title), ' is free with an account.'));
      }
    }

    const off = auth.on('change', render);
    render();
    return () => {
      off();
      cards?.destroy();
    };
  },
};
