// Account: session status, plan, subscribe / manage billing, sign in & out.
// Supports #account.signup (emphasize create-account) and return-after-login via
// access.rememberReturn / consumeReturn (set by the router gate for Beginner/Advanced).
import { h, icon, toast } from '../core/ui.js';
import { PLANS, FREE_IDS } from '../config.js';
import * as access from '../core/access.js';

function levelLabel(level) {
  if (level === 'advanced') return 'Advanced';
  if (level === 'beginner') return 'Beginner';
  if (level === 'free') return 'Free';
  return 'Signed out';
}

function goAfterAuth(ctx) {
  const ret = access.consumeReturn();
  if (ret) {
    ctx.navigate(ret);
    return true;
  }
  return false;
}

export default {
  mount(root, ctx) {
    const body = h('div', { class: 'account-body' });
    const formWrap = h('div', { class: 'account-forms', 'aria-live': 'polite' });
    const msg = h('p', { class: 'muted account__msg', role: 'status' }, '');
    const mode = (ctx.param || ctx.route?.param || '').toLowerCase(); // 'signup' | 'signin' | ''
    const preferSignup = mode === 'signup' || mode === 'sign-up';

    function renderSignedOut() {
      const pending = access.peekReturn();
      const returnNote = pending
        ? h('p', { class: 'account__return muted' },
          'After you sign in we will take you back to ',
          h('code', { class: 'mono' }, `#${pending}`),
          '.')
        : null;

      const signInForm = h('form', {
        class: ['card', 'account-card', !preferSignup && 'account-card--focus'],
        on: {
          submit: async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            msg.textContent = 'Signing in…';
            const res = await access.signIn({
              email: String(fd.get('email') || '').trim(),
              password: String(fd.get('password') || ''),
            });
            if (!res.ok) {
              msg.textContent = res.error || 'Could not sign in';
              toast(res.error || 'Could not sign in', { type: 'warn' });
              return;
            }
            toast('Signed in', { type: 'info' });
            if (!goAfterAuth(ctx)) paint();
          },
        },
      },
        h('h2', null, 'Sign in'),
        h('label', { class: 'field' }, h('span', null, 'Email'),
          h('input', { type: 'email', name: 'email', required: true, class: 'input', autocomplete: 'email', 'aria-label': 'Email' })),
        h('label', { class: 'field' }, h('span', null, 'Password'),
          h('input', { type: 'password', name: 'password', required: true, class: 'input', autocomplete: 'current-password', 'aria-label': 'Password', minlength: '6' })),
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'Sign in'),
      );

      const signUpForm = h('form', {
        class: ['card', 'account-card', preferSignup && 'account-card--focus'],
        id: preferSignup ? 'account-signup' : undefined,
        on: {
          submit: async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            msg.textContent = 'Creating account…';
            const res = await access.signUp({
              email: String(fd.get('email') || '').trim(),
              password: String(fd.get('password') || ''),
              displayName: String(fd.get('displayName') || '').trim() || undefined,
            });
            if (!res.ok) {
              msg.textContent = res.error || 'Could not sign up';
              toast(res.error || 'Could not sign up', { type: 'warn' });
              return;
            }
            if (res.needsConfirmation) {
              msg.textContent = 'Check your email to confirm, then sign in.';
              toast('Confirm your email to finish sign-up', { type: 'info', duration: 6000 });
            } else {
              toast('Account created', { type: 'info' });
              if (!goAfterAuth(ctx)) paint();
            }
          },
        },
      },
        h('h2', null, 'Create account'),
        h('label', { class: 'field' }, h('span', null, 'Display name'),
          h('input', { type: 'text', name: 'displayName', class: 'input', autocomplete: 'nickname', 'aria-label': 'Display name' })),
        h('label', { class: 'field' }, h('span', null, 'Email'),
          h('input', { type: 'email', name: 'email', required: true, class: 'input', autocomplete: 'email', 'aria-label': 'Email' })),
        h('label', { class: 'field' }, h('span', null, 'Password'),
          h('input', { type: 'password', name: 'password', required: true, class: 'input', autocomplete: 'new-password', 'aria-label': 'Password', minlength: '6' })),
        h('button', { type: 'submit', class: preferSignup ? 'btn btn--primary' : 'btn btn--ghost' }, 'Create account'),
      );

      // Sign-up mode (from gated Beginner/Advanced): put Create account first.
      const forms = preferSignup ? [signUpForm, signInForm] : [signInForm, signUpForm];

      formWrap.replaceChildren(
        returnNote,
        preferSignup
          ? h('p', { class: 'lead account__gate-note' },
            'Create a free account to open the Beginner and Advanced tracks. Sign-in is below if you already have one.')
          : null,
        h('div', { class: 'account-grid' }, ...forms),
        msg,
        h('p', { class: 'faint' }, 'If subscribe buttons say “Subscriptions not open yet”, Stripe secrets are not configured — see docs/SECRETS.md.'),
      );

      // Focus the preferred form's first email field.
      queueMicrotask(() => {
        const sel = preferSignup
          ? '#account-signup input[name="email"], .account-card--focus input[name="email"]'
          : '.account-card--focus input[name="email"]';
        formWrap.querySelector(sel)?.focus?.();
      });
    }

    function renderSignedIn(a) {
      const plan = a.level && PLANS[a.level];
      formWrap.replaceChildren(
        h('section', { class: 'card account-card' },
          h('p', { class: 'eyebrow' }, 'Signed in'),
          h('h2', null, a.user?.email || 'Member'),
          h('p', { class: 'account__plan' },
            h('span', { class: 'chip' }, levelLabel(a.level)),
            plan ? h('span', { class: 'muted' }, ` · $${plan.price}/mo`) : h('span', { class: 'muted' }, ' · free unit + library')),
          h('div', { class: 'row' },
            a.level !== 'advanced'
              ? h('button', {
                type: 'button', class: 'btn btn--primary',
                on: {
                  click: async () => {
                    const planId = a.level === 'beginner' ? 'advanced' : 'beginner';
                    const res = await access.checkout(planId);
                    if (!res.ok) toast(res.error || 'Subscriptions not open yet', { type: 'warn', duration: 5000 });
                    else if (res.switched) { toast('Plan updated', { type: 'info' }); paint(); }
                  },
                },
              }, a.level === 'beginner' ? 'Upgrade to Advanced' : 'Get Beginner')
              : null,
            h('button', {
              type: 'button', class: 'btn btn--ghost',
              'aria-label': 'Manage billing in Stripe portal',
              on: {
                click: async () => {
                  const res = await access.openBillingPortal();
                  if (!res.ok) toast(res.error || 'Subscriptions not open yet', { type: 'warn', duration: 5000 });
                },
              },
            }, icon('compass', { size: 14 }), 'Manage billing'),
            h('button', {
              type: 'button', class: 'btn btn--ghost',
              on: {
                click: async () => {
                  await access.signOut();
                  toast('Signed out', { type: 'info' });
                  paint();
                },
              },
            }, 'Sign out'),
          ),
        ),
        h('section', { class: 'card' },
          h('h3', null, 'Free modules'),
          h('ul', { class: 'lesson-list' },
            FREE_IDS.map((id) => {
              const e = ctx.registry?.findEntry?.(id);
              if (!e) return null;
              return h('li', null, h('a', { href: `#${e.type === 'game' ? 'g' : 'l'}.${e.id}` }, e.title));
            }),
          ),
          h('p', { class: 'row' },
            h('a', { class: 'btn btn--ghost', href: '#dashboard' }, 'Dashboard'),
            h('a', { class: 'btn btn--ghost', href: '#beginner' }, 'Beginner track')),
        ),
        msg,
      );
    }

    function paint() {
      const a = access.getAccess();
      // Already signed in with a pending return (e.g. session restored after gate redirect).
      if (a.user && goAfterAuth(ctx)) return;
      body.replaceChildren(
        h('p', { class: 'eyebrow' }, preferSignup && !a.user ? 'Join The Trade School' : 'Account'),
        h('h1', null, preferSignup && !a.user ? 'Create your account' : 'Your account'),
        h('p', { class: 'lead' },
          preferSignup && !a.user
            ? 'Beginner and Advanced lessons need a free account. Home, Dashboard and the other tools stay open without signing in. Educational use only — not financial advice.'
            : 'Sign in with email and password to open Beginner and Advanced lessons and games. Plan status and billing live here too. Educational use only — not financial advice.'),
      );
      msg.textContent = '';
      if (a.user) renderSignedIn(a);
      else renderSignedOut();
    }

    root.append(h('div', { class: 'container account' }, body, formWrap));
    let unsub = null;
    access.ready.then(() => {
      paint();
      unsub = access.onChange(() => {
        // Prefer return-to over re-painting account when a pending hash exists.
        if (access.getAccess().user && access.peekReturn()) {
          goAfterAuth(ctx);
          return;
        }
        paint();
      });
    });
    return () => { if (unsub) unsub(); };
  },
};
