// #account — profile (display name), plan + billing status, Manage billing, change password,
// progress sync status, sign out, and the ?checkout=success flow ("Payment received — unlocking
// your plan…" while auth polls the access level, then a confirmation with a link onwards).
import { h, icon, toast, confetti, uid } from '../core/ui.js';
import { auth } from '../core/auth.js';
import { getSync } from '../core/sync.js';
import { PLAN_LABELS, planChipLabel, canOpen, describeTarget } from '../core/access.js';
import { PLANS } from '../config.js';
import { parseHash } from '../core/router.js';
import { field, passwordField, formAlert, wireForm } from './auth.js';

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return fmtDate(new Date(ts).toISOString());
}

function avatar(name, size = 'lg') {
  const initial = (String(name || '?').trim()[0] || '?').toUpperCase();
  return h('span', { class: `avatar avatar--${size}`, 'aria-hidden': 'true' }, initial);
}

function planChip(level) {
  const text = planChipLabel(level);
  if (!text) return null;
  return h('span', { class: ['chip', 'plan-chip', `plan-chip--${level}`] }, level === 'free' ? null : icon('star-fill', { size: 12 }), text);
}

/** Where "Continue" goes after a successful checkout: the remembered item if it is now open. */
function continueTarget(level) {
  const to = auth.peekReturnTo();
  if (to) {
    const route = parseHash(to);
    const info = describeTarget(route);
    if (info && canOpen(route, level)) return { hash: to, label: `Continue: ${info.title}` };
  }
  const tier = level === 'advanced' ? 'advanced' : 'beginner';
  return { hash: tier, label: `Open the ${tier === 'advanced' ? 'Advanced' : 'Beginner'} track` };
}

// ---------------------------------------------------------------- checkout return panel

function unlockPanel() {
  const el = h('section', { class: 'unlock', 'aria-live': 'polite' });
  let celebrated = false;
  function render() {
    const u = auth.unlock;
    el.replaceChildren();
    el.hidden = !u;
    if (!u) return;
    el.dataset.state = u.state;
    if (u.state === 'polling') {
      el.append(
        h('span', { class: 'spinner spinner--lg', 'aria-hidden': 'true' }),
        h('div', null,
          h('h2', { class: 'unlock__title' }, u.source === 'switch' ? 'Switching your plan…' : 'Payment received — unlocking your plan…'),
          h('p', { class: 'muted' }, 'This usually takes a few seconds. You can stay on this page.')));
    } else if (u.state === 'done') {
      const lv = u.level || auth.level;
      const go = continueTarget(lv);
      el.append(
        h('div', { class: 'unlock__badge', 'aria-hidden': 'true' }, icon('check', { size: 30 })),
        h('div', { class: 'unlock__body' },
          h('h2', { class: 'unlock__title' }, `You're on the ${PLAN_LABELS[lv] || 'new plan'}!`),
          h('p', { class: 'muted' }, lv === 'advanced'
            ? 'Every Beginner and Advanced lesson and game is unlocked. Thank you for supporting The Trade School.'
            : 'Every Beginner lesson and game is unlocked. Thank you for supporting The Trade School.'),
          h('div', { class: 'row' },
            h('a', { class: 'btn btn--primary', href: `#${go.hash}`, 'data-action': 'continue', on: { click: () => auth.takeReturnTo() } }, go.label, icon('arrow-right', { size: 16 })),
            h('a', { class: 'btn btn--ghost', href: '#progress' }, 'Your progress'))));
      if (!celebrated) {
        celebrated = true;
        requestAnimationFrame(() => confetti(el));
      }
    } else if (u.state === 'slow') {
      el.append(
        h('div', { class: 'unlock__badge unlock__badge--calm', 'aria-hidden': 'true' }, icon('clock', { size: 28 })),
        h('div', { class: 'unlock__body' },
          h('h2', { class: 'unlock__title' }, 'Your payment went through'),
          h('p', { class: 'muted' }, 'Unlocking your plan is taking a little longer than usual. It normally finishes within a minute or two: refresh this page shortly. If your plan still does not show after that, contact us and we will sort it out.'),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn', 'data-action': 'check-again', on: { click: async (e) => {
              const b = e.currentTarget;
              b.disabled = true;
              await auth.refreshAccess({ force: true });
              b.disabled = false;
              if (auth.level === 'beginner' || auth.level === 'advanced') toast(`${PLAN_LABELS[auth.level]} unlocked.`, { type: 'good' });
              else toast('Not yet — try again in a moment.', { type: 'info' });
            } } }, icon('restart', { size: 16 }), 'Check again'))));
    } else if (u.state === 'signin') {
      el.append(
        h('div', { class: 'unlock__badge unlock__badge--calm', 'aria-hidden': 'true' }, icon('info', { size: 28 })),
        h('div', { class: 'unlock__body' },
          h('h2', { class: 'unlock__title' }, 'Payment received'),
          h('p', { class: 'muted' }, 'Sign in to finish unlocking your plan on this device.'),
          h('a', { class: 'btn btn--primary', href: '#signin' }, 'Sign in')));
    }
  }
  render();
  return { el, render };
}

// ---------------------------------------------------------------- sections

function billingSection() {
  const body = h('div', { class: 'acct-billing', 'aria-live': 'polite' }, h('p', { class: 'muted' }, 'Loading your plan…'));
  const alert = formAlert();
  let data = null;
  let loadErr = null;
  let pending = false;

  async function load() {
    try {
      data = await auth.getBilling();
      loadErr = null;
    } catch (err) {
      loadErr = err;
    }
    render();
  }

  async function run(fn) {
    if (pending) return;
    pending = true;
    alert.clear();
    render();
    try {
      await fn();
    } catch (err) {
      alert.show(err?.message || 'Something went wrong. Please try again.');
    } finally {
      pending = false;
      render();
    }
  }

  function render() {
    const lv = auth.level;
    const sub = data?.subscription || null;
    const grant = data?.grants?.[0] || null;
    const busy = auth.billingBusy || pending;
    const offline = auth.mode === 'offline';
    body.replaceChildren();
    body.append(h('div', { class: 'row row--sm acct-billing__plan' }, planChip(lv),
      sub?.status === 'past_due' ? h('span', { class: 'chip chip--bear chip--sm' }, 'Payment overdue') : null));

    const lines = [];
    if (sub && ['active', 'trialing', 'past_due'].includes(sub.status)) {
      const end = fmtDate(sub.current_period_end);
      if (sub.status === 'trialing' && end) lines.push(`Trial ends on ${end}.`);
      else if (sub.cancel_at_period_end && end) lines.push(`Cancels on ${end}. You keep your plan until then.`);
      else if (end) lines.push(`Renews on ${end} at $${PLANS[sub.plan]?.price.toFixed(2)} a month.`);
      if (sub.plan && PLANS[sub.plan] && sub.plan !== lv && lv !== 'advanced') lines.push(`Your subscription is for the ${PLANS[sub.plan].name} plan; it may take a moment to show here.`);
    } else if (sub && sub.status === 'canceled') {
      lines.push(`Your ${PLANS[sub.plan]?.name || ''} subscription has ended.`.replace('  ', ' '));
    } else if (sub && (sub.status === 'incomplete' || sub.status === 'unpaid')) {
      lines.push('Your last checkout was not completed. No plan is active.');
    }
    if (grant && (lv === grant.plan || lv === 'advanced')) {
      const until = fmtDate(grant.expires_at);
      lines.push(`Complimentary ${PLANS[grant.plan]?.name || ''} access${until ? ` until ${until}` : ''}.`.replace('  ', ' '));
    }
    if (!lines.length && lv === 'free') lines.push('Free plan: unit 1, the Daily Challenge, the Pattern Library and the Setup Playbook.');
    for (const l of lines) body.append(h('p', { class: 'muted acct-billing__line' }, l));

    if (sub?.status === 'past_due') {
      body.append(h('div', { class: 'callout callout--warn', role: 'alert' }, icon('info', { size: 18 }),
        h('p', null, h('strong', null, 'Your last payment failed. '), 'Update your card in Manage billing to keep your plan.')));
    }
    if (loadErr) body.append(h('p', { class: 'faint t-14' }, `Billing details are unavailable right now (${loadErr.message})`));

    const actions = h('div', { class: 'row acct-billing__actions' });
    if (sub) {
      actions.append(h('button', {
        type: 'button', class: ['btn', sub.status === 'past_due' && 'btn--primary'], 'data-action': 'manage-billing', disabled: busy || offline,
        on: { click: () => run(() => auth.openBillingPortal()) },
      }, icon('shield', { size: 16 }), pending ? 'Opening billing…' : 'Manage billing'));
    }
    if (lv === 'free') {
      actions.append(h('a', { class: 'btn btn--primary', href: '#pricing' }, 'See plans', icon('arrow-right', { size: 16 })));
    } else if (lv === 'beginner') {
      actions.append(h('button', {
        type: 'button', class: 'btn btn--primary', 'data-action': 'upgrade', disabled: busy || offline,
        on: { click: () => run(async () => {
          const r = await auth.checkout('advanced');
          if (r?.switched) toast('Switching you to Advanced…', { type: 'info' });
        }) },
      }, 'Upgrade to Advanced', icon('arrow-right', { size: 16 })));
    }
    if (actions.childElementCount) body.append(actions);
    if (auth.billingBusy) body.append(h('p', { class: 'faint t-14' }, 'Billing buttons are paused while your payment is confirmed.'));
    body.append(alert.el);
  }

  const off = auth.on('change', ({ reason } = {}) => {
    if (reason === 'billing' || reason === 'unlock' && auth.unlock?.state === 'done') load();
    else render();
  });
  load();
  return {
    el: h('section', { class: 'acct-card card', 'aria-labelledby': 'acct-plan-h' },
      h('h2', { class: 'acct-card__title', id: 'acct-plan-h' }, icon('star', { size: 18 }), 'Plan & billing'),
      body),
    destroy: off,
  };
}

function profileSection() {
  const alert = formAlert();
  const name = field({ label: 'Display name', name: 'display_name', autocomplete: 'nickname', maxlength: 60, value: auth.displayName });
  const email = h('p', { class: 'acct-email' }, h('span', { class: 'field__label' }, 'Email'), h('span', { class: 'mono acct-email__value' }, auth.user?.email || ''));
  const submit = h('button', { type: 'submit', class: 'btn', 'data-action': 'save-name' }, 'Save name');
  const form = h('form', { class: 'stack acct-form', 'aria-label': 'Profile' }, alert.el, name.el, h('div', { class: 'row' }, submit), email);
  wireForm(form, submit, alert, async () => {
    const v = name.value().trim();
    if (!v) {
      name.setError('Enter a display name.');
      throw new Error('Check the highlighted field.');
    }
    await auth.updateProfile({ displayName: v });
    alert.show('Saved.', 'good');
  }, { pendingLabel: 'Saving…' });
  return h('section', { class: 'acct-card card', 'aria-labelledby': 'acct-prof-h' },
    h('h2', { class: 'acct-card__title', id: 'acct-prof-h' }, icon('book', { size: 18 }), 'Profile'),
    form);
}

function syncSection() {
  const text = h('p', { class: 'acct-sync__text' });
  const dot = h('span', { class: 'sync-dot', 'aria-hidden': 'true' });
  const btn = h('button', { type: 'button', class: 'btn btn--sm', 'data-action': 'sync-now' }, icon('restart', { size: 14 }), 'Sync now');
  const sync = getSync();
  const render = () => {
    const st = sync?.status || { state: 'local' };
    let msg;
    if (!sync || !auth.user) msg = 'Saved on this device only.';
    else if (st.state === 'synced' && st.at) msg = `Synced ${ago(st.at)}. Your progress follows you to any device you sign in on.`;
    else if (st.state === 'syncing') msg = 'Syncing…';
    else if (st.state === 'error') msg = `Could not sync${st.retryAt ? `, retrying in ${Math.max(1, Math.round((st.retryAt - Date.now()) / 1000))} s` : ''}. Saved on this device only for now.`;
    else if (st.state === 'offline') msg = 'Offline: saved on this device only for now.';
    else msg = 'Saved on this device only.';
    text.textContent = msg;
    dot.dataset.state = st.state;
    btn.disabled = !sync || !auth.user || st.state === 'syncing';
  };
  btn.addEventListener('click', () => sync?.syncNow());
  const off = sync?.on(render);
  const t = setInterval(render, 15000);
  render();
  return {
    el: h('section', { class: 'acct-card card', 'aria-labelledby': 'acct-sync-h' },
      h('h2', { class: 'acct-card__title', id: 'acct-sync-h' }, icon('layers', { size: 18 }), 'Progress sync'),
      h('div', { class: 'acct-sync', role: 'status' }, dot, text),
      h('div', { class: 'row' }, btn, h('a', { class: 'link-btn', href: '#progress' }, 'See your progress', icon('arrow-right', { size: 14 })))),
    destroy() {
      off?.();
      clearInterval(t);
    },
  };
}

function securitySection(ctx) {
  const alert = formAlert();
  const pw = passwordField({ label: 'New password', name: 'new-password', autocomplete: 'new-password', strength: true, hint: 'At least 8 characters.' });
  const pw2 = passwordField({ label: 'Confirm new password', name: 'confirm-password', autocomplete: 'new-password' });
  const submit = h('button', { type: 'submit', class: 'btn', 'data-action': 'change-password' }, 'Change password');
  const form = h('form', { class: 'stack acct-form', 'aria-label': 'Change password' }, alert.el, pw.el, pw2.el, h('div', { class: 'row' }, submit));
  const panelId = uid('pw-panel');
  const panel = h('div', { id: panelId, hidden: true }, form);
  const toggle = h('button', { type: 'button', class: 'btn btn--ghost acct-toggle', 'aria-expanded': 'false', 'aria-controls': panelId, on: { click: () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) pw.input.focus();
  } } }, icon('shield', { size: 16 }), 'Change password', icon('chevron-down', { size: 14 }));
  wireForm(form, submit, alert, async () => {
    if (pw.value().length < 8) {
      pw.setError('Use at least 8 characters.');
      throw new Error('Check the highlighted field.');
    }
    if (pw.value() !== pw2.value()) {
      pw2.setError('The two passwords do not match.');
      throw new Error('Check the highlighted field.');
    }
    await auth.updatePassword(pw.value());
    pw.input.value = '';
    pw2.input.value = '';
    alert.show('Password changed.', 'good');
  }, { pendingLabel: 'Saving…' });

  const signOut = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'sign-out', on: { click: async () => {
    signOut.disabled = true;
    signOut.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Signing out…');
    try {
      await auth.signOut();
      toast('Signed out. Your progress is saved in your account.', { type: 'info' });
      ctx.navigate('home');
    } catch (err) {
      toast(err?.message || 'Could not sign out. Please try again.', { type: 'bad' });
      signOut.disabled = false;
    }
  } } }, icon('arrow-left', { size: 16 }), 'Sign out');

  return h('section', { class: 'acct-card card', 'aria-labelledby': 'acct-sec-h' },
    h('h2', { class: 'acct-card__title', id: 'acct-sec-h' }, icon('shield', { size: 18 }), 'Security'),
    h('div', { class: 'row' }, toggle, signOut),
    panel,
    h('p', { class: 'faint t-14' }, 'Want a copy of your data or your account deleted? See the ', h('a', { href: '#privacy' }, 'privacy policy'), '.'));
}

// ---------------------------------------------------------------- page

export default {
  id: 'account',
  async mount(root, ctx) {
    const wrap = h('div', { class: 'account container' }, h('p', { class: 'muted', role: 'status' }, 'Loading your account…'));
    root.append(wrap);
    await auth.ready;
    const cleanups = [];
    const panel = unlockPanel();
    cleanups.push(auth.on('change', ({ reason } = {}) => {
      if (reason === 'unlock' || reason === 'level') panel.render();
    }));

    // Came back from an email link (confirmation / magic link) with somewhere to go? Go there.
    if (auth.user && auth.consumeLinkSignIn()) {
      const to = auth.takeReturnTo();
      auth.consumeFlash();
      toast(`Welcome, ${auth.displayName}! You are signed in.`, { type: 'good' });
      if (to) {
        ctx.navigate(to);
        return () => cleanups.forEach((fn) => fn());
      }
    }

    let drawn = [];
    const draw = () => {
      for (const fn of drawn.splice(0)) fn();
      const flash = auth.consumeFlash();
      const flashEl = flash ? h('div', { class: `form-alert__box form-alert__box--${flash.tone === 'good' ? 'good' : flash.tone === 'info' ? 'info' : 'bad'}`, role: 'status' },
        icon(flash.tone === 'good' ? 'check' : 'info', { size: 18 }), h('p', { class: 'form-alert__text' }, flash.text)) : null;

      if (!auth.user) {
        wrap.replaceChildren(
          panel.el,
          h('div', { class: 'auth container--read' },
            h('div', { class: 'auth__card card card--raised' },
              h('h1', { class: 'auth__title' }, 'Your account'),
              flashEl,
              auth.mode === 'offline'
                ? h('p', { class: 'muted' }, 'Accounts are unavailable right now. The free lessons and games still work; please try again in a little while.')
                : h('p', { class: 'muted' }, 'Sign in to see your plan, manage billing and keep your progress in sync across devices.'),
              h('div', { class: 'row' },
                h('a', { class: 'btn btn--primary', href: '#signin' }, 'Sign in'),
                h('a', { class: 'btn', href: '#signup' }, 'Create free account')))));
        return;
      }
      const billing = billingSection();
      const sync = syncSection();
      drawn.push(billing.destroy, sync.destroy);
      const name = h('span', null, auth.displayName);
      const chip = h('span', null, planChip(auth.level));
      drawn.push(auth.on('change', ({ reason } = {}) => {
        if (reason === 'profile') name.textContent = auth.displayName;
        chip.replaceChildren(planChip(auth.level) || '');
      }));
      wrap.replaceChildren(
        flashEl,
        panel.el,
        h('header', { class: 'account__head' },
          avatar(auth.displayName),
          h('div', { class: 'account__id' },
            h('p', { class: 'eyebrow' }, 'Your account'),
            h('h1', { class: 'account__name' }, name),
            h('p', { class: 'account__email mono' }, auth.user.email)),
          chip),
        h('div', { class: 'account__grid' },
          billing.el,
          sync.el,
          profileSection(),
          securitySection(ctx)));
    };
    draw();
    let who = auth.user?.id || null;
    cleanups.push(auth.on('change', () => {
      const now = auth.user?.id || null;
      if (now !== who) {
        who = now;
        draw();
      }
    }));
    return () => {
      cleanups.forEach((fn) => fn());
      drawn.forEach((fn) => fn());
    };
  },
};
