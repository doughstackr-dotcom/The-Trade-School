// Paywall: shown by the router when setAccessGate blocks a lesson/game/course page.
// Unsigned visitors are steered to sign-up/login; signed-in free users see plan cards.
import { h, icon, modal, toast } from '../core/ui.js';
import { PLANS } from '../config.js';
import * as access from '../core/access.js';

const CHECKOUT_PENDING = true;

const PLAN_COPY = {
  free: {
    name: 'Free',
    price: '$0',
    cadence: '',
    note: 'Free account required',
    perk: 'Daily Challenge',
  },
  beginner: {
    name: 'Beginner',
    price: `$${PLANS.beginner.price}`,
    cadence: '/ month',
    note: '',
    perk: 'Full Beginner track',
  },
  advanced: {
    name: 'Advanced',
    price: `$${PLANS.advanced.price}`,
    cadence: '/ month',
    note: '',
    perk: 'Full Advanced track',
  },
};

function planCard(planId, { selected = false, current = null, onSelect } = {}) {
  const p = PLAN_COPY[planId];
  if (!p) return null;
  const included = current === 'advanced' && planId === 'beginner';
  const currentPlan = current === planId || included;
  return h('button', {
    type: 'button',
    role: 'radio',
    class: ['plan-card', selected && 'is-selected', currentPlan && 'is-current'],
    'aria-checked': String(selected),
    'aria-label': `${p.name} plan, ${p.price}${p.cadence ? ` ${p.cadence}` : ''}`,
    on: { click: () => onSelect?.(planId) },
  },
    h('span', { class: 'plan-card__selector', 'aria-hidden': 'true' }),
    h('span', { class: 'plan-card__body' },
      h('span', { class: 'plan-card__topline' },
        h('span', { class: 'plan-card__title' }, p.name),
        currentPlan ? h('span', { class: 'plan-card__badge' }, included ? 'Included' : 'Current') : null),
      h('span', { class: 'plan-card__price' },
        h('span', { class: 'plan-card__amount' }, p.price),
        p.cadence ? h('span', { class: 'plan-card__cadence' }, ` ${p.cadence}`) : null),
      p.note ? h('span', { class: 'plan-card__note' }, p.note) : null,
      h('span', { class: 'plan-card__rule' }),
      h('span', { class: 'plan-card__perk' }, icon('check', { size: 18 }), p.perk)));
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

    const status = h('p', { class: 'muted paywall__status', 'aria-live': 'polite' }, '');
    const plansHost = h('section', {
      class: 'paywall__plans',
      role: 'radiogroup',
      'aria-label': 'Choose a plan',
    });
    const ctaHost = h('div', { class: 'paywall__cta' });
    let upgradeModal = null;
    let upgradeShownFor = '';
    let selectedPlan = 'free';

    function setSelectedPlan(planId) {
      if (!PLAN_COPY[planId]) return;
      selectedPlan = planId;
      paint(access.getAccess());
    }

    async function onSubscribe(planId) {
      if (planId === 'free') {
        ctx.navigate('account.signup');
        return;
      }
      if (CHECKOUT_PENDING) {
        status.textContent = 'Checkout is intentionally unavailable until Stripe and live tier access are verified.';
        toast('Checkout testing is pending', { type: 'info', duration: 5000 });
        return;
      }
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
        ctx.navigate(routeKey || 'home');
      }
    }

    function showUpgradeModal(a) {
      if (!a.user || a.level === 'advanced') return;
      const key = `${routeKey}:${a.level}:${need}`;
      if (upgradeModal || upgradeShownFor === key) return;
      upgradeShownFor = key;
      const intro = a.level === 'beginner' && need === 'advanced'
        ? 'Your Beginner plan is active. Advanced modules stay locked until this account is upgraded.'
        : 'You are signed in on the free tier. Free modules open now; Beginner and Advanced modules stay locked until subscriptions are verified.';
      upgradeModal = modal({
        title: need === 'advanced' ? 'Advanced access needed' : 'Upgrade to unlock',
        size: 'lg',
        body: h('div', { class: 'upgrade-modal' },
          h('p', { class: 'upgrade-modal__lead' }, intro),
          h('p', { class: 'callout callout--warn' },
            'Payments are temporarily unavailable.'),
          h('div', { class: 'paywall__plans upgrade-modal__plans' },
            planCard('beginner', { selected: need !== 'advanced', current: a.level, onSelect: setSelectedPlan }),
            planCard('advanced', { selected: need === 'advanced', current: a.level, onSelect: setSelectedPlan }))),
        actions: [
          { label: 'Back to Dashboard', onClick: () => ctx.navigate(back) },
          { label: 'Close', primary: true },
        ],
        onClose: () => { upgradeModal = null; },
      });
    }

    function paint(a) {
      const signedIn = !!a.user;
      if (signedIn && selectedPlan === 'free') {
        selectedPlan = need === 'beginner' || need === 'advanced' ? need : a.level || 'free';
      }

      plansHost.replaceChildren(
        planCard('free', { selected: selectedPlan === 'free', current: a.level, onSelect: setSelectedPlan }),
        planCard('beginner', { selected: selectedPlan === 'beginner', current: a.level, onSelect: setSelectedPlan }),
        planCard('advanced', { selected: selectedPlan === 'advanced', current: a.level, onSelect: setSelectedPlan }),
      );

      ctaHost.replaceChildren(
        h('button', {
          type: 'button',
          class: 'btn btn--primary paywall__main-cta',
          disabled: signedIn && selectedPlan !== 'free' && CHECKOUT_PENDING,
          title: signedIn && selectedPlan !== 'free' && CHECKOUT_PENDING
            ? 'Checkout setup and live tier testing are pending.'
            : '',
          on: { click: () => onSubscribe(selectedPlan) },
        }, signedIn && selectedPlan !== 'free' && CHECKOUT_PENDING
          ? 'Checkout testing pending'
          : signedIn && selectedPlan === 'free'
            ? 'Open account'
            : 'Create free account',
        icon('arrow-right', { size: 18 })),
        signedIn
          ? h('p', { class: 'paywall__cta-note muted' },
            selectedPlan === 'free'
              ? 'Free modules are available from your account.'
              : 'Checkout remains disabled until Stripe and live tier access are verified.')
          : h('p', { class: 'paywall__signin-line muted' },
            'Already a member? ',
            h('a', { href: '#account' }, 'Sign in')),
      );

      if (!signedIn) {
        if (upgradeModal) upgradeModal.close();
        status.textContent = title !== 'This page'
          ? `${title} needs an account first. Choose Free to start, then upgrade when you are ready.`
          : '';
      } else {
        if (a.level === 'advanced' && upgradeModal) upgradeModal.close();
        if (a.level === 'advanced') {
          status.textContent = 'You already have Advanced access. If this page is stuck, refresh.';
        } else if (a.level === 'beginner') {
          status.textContent = need === 'advanced'
            ? 'Your Beginner plan is active. Upgrade to Advanced to open this module.'
            : 'Your Beginner plan should unlock this - try refreshing.';
        } else {
          status.textContent = 'Signed in on the free tier. The Daily Challenge stays free; choose a plan for the full tracks.';
        }
        showUpgradeModal(a);
      }
    }

    root.append(
      h('div', { class: 'paywall' },
        h('section', { class: 'paywall__hero', 'aria-labelledby': 'paywall-h' },
          h('h1', { id: 'paywall-h' }, 'Your next step starts here'),
          h('p', { class: 'lead' }, entry
            ? `${title} needs a ${planName === 'Paid' ? 'member account' : `${planName} plan`}. Create a free account to enter the school, then upgrade when you are ready.`
            : 'Create a free account to enter the school. Upgrade when you are ready for the full tracks.'),
          status,
        ),
        h('section', { class: 'paywall__plan-band', 'aria-label': 'Plan options' }, plansHost),
        ctaHost,
        h('p', { class: 'paywall__risk muted' },
          'Educational simulations only - not financial advice. Subscriptions can be cancelled in the billing portal.'),
        h('p', { class: 'paywall__back' },
          h('a', { href: `#${back}` }, icon('arrow-left', { size: 16 }),
            back === 'home' ? 'Back home' : 'Back to Dashboard')),
      ),
    );

    let unsub = null;
    access.ready.then(() => {
      paint(access.getAccess());
      unsub = access.onChange(() => paint(access.getAccess()));
    });
    return () => {
      if (unsub) unsub();
      if (upgradeModal) upgradeModal.close();
    };
  },
};
